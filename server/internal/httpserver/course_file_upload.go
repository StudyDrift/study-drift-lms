package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/courseroles"
	"github.com/lextures/lextures/server/internal/repos/coursefiles"
	"github.com/lextures/lextures/server/internal/service/filestorage"
)

type postCourseFileResponse struct {
	ObjectKey       string `json:"object_key"`
	PresignedPutURL string `json:"presigned_put_url,omitempty"`
	ExpiresAt       string `json:"expires_at,omitempty"`
}

// handlePostCourseFile is POST /api/v1/courses/{course_code}/course-files
// When an S3 driver is configured, returns a presigned PUT URL.
// When using local storage, uploads the body directly.
func (d Deps) handlePostCourseFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		canEdit, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			log.Printf("course-file-post: permission check failed course=%q err=%v", courseCode, err)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canEdit {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to upload files.")
			return
		}

		filename := strings.TrimSpace(r.URL.Query().Get("filename"))
		if filename == "" {
			filename = "upload"
		}
		ext := filepath.Ext(filename)
		fileUUID := uuid.New().String()
		objectKey := fmt.Sprintf("files/%s/%s%s", courseCode, fileUUID, ext)

		cfg := d.effectiveConfig()

		if d.Storage != nil {
			// Check if the driver supports presigned URLs (S3/R2/MinIO)
			ttl := time.Duration(cfg.StoragePresignTTL) * time.Second
			if ttl <= 0 {
				ttl = time.Hour
			}
			// For S3: return presigned PUT URL (client uploads directly)
			if s3d, ok := d.Storage.(*filestorage.S3Driver); ok {
				putURL, putErr := s3d.PresignedPutURL(r.Context(), objectKey, ttl)
				if putErr != nil {
					log.Printf("course-file-post: presign PUT key=%q err=%v", objectKey, putErr)
					apierr.WriteJSON(w, http.StatusBadGateway, apierr.CodeInternal, "Storage unavailable.")
					return
				}
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(postCourseFileResponse{
					ObjectKey:       objectKey,
					PresignedPutURL: putURL,
					ExpiresAt:       time.Now().Add(ttl).UTC().Format(time.RFC3339),
				})
				return
			}
		}

		// Local driver: accept the request body directly
		ct := r.Header.Get("Content-Type")
		if ct == "" {
			ct = "application/octet-stream"
		}
		if d.Storage != nil {
			if err := d.Storage.PutObject(r.Context(), objectKey, r.Body, r.ContentLength, ct); err != nil {
				log.Printf("course-file-post: put key=%q err=%v", objectKey, err)
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to store file.")
				return
			}
		} else {
			// No storage configured at all — fall back to the legacy disk write
			root := strings.TrimSpace(cfg.CourseFilesRoot)
			if root == "" {
				root = "data/course-files"
			}
			p := coursefiles.BlobDiskPath(root, courseCode, fileUUID+ext)
			if writeErr := writeLocalFile(p, r.Body); writeErr != nil {
				log.Printf("course-file-post: disk write key=%q err=%v", objectKey, writeErr)
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to store file.")
				return
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(postCourseFileResponse{ObjectKey: objectKey})
	}
}

// handleDeleteCourseFile is DELETE /api/v1/courses/{course_code}/course-files/{file_id}
// Enqueues background deletion; returns 202 Accepted.
func (d Deps) handleDeleteCourseFile() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		canEdit, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			log.Printf("course-file-delete: permission check course=%q err=%v", courseCode, err)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canEdit {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to delete files.")
			return
		}
		fileID, err := uuid.Parse(chi.URLParam(r, "file_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid file id.")
			return
		}
		row, err := coursefiles.GetForCourse(r.Context(), d.Pool, courseCode, fileID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load file.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}

		// Capture values for the goroutine before request context is cancelled
		storageKey := row.StorageKey
		storage := d.Storage
		cfg := d.effectiveConfig()

		// Fire-and-forget background deletion (per FR-7)
		go func() {
			if storage != nil {
				if delErr := storage.DeleteObject(context.Background(), storageKey); delErr != nil {
					log.Printf("course-file-delete: background delete key=%q err=%v", storageKey, delErr)
				}
			} else {
				root := strings.TrimSpace(cfg.CourseFilesRoot)
				if root == "" {
					root = "data/course-files"
				}
				coursefiles.RemoveStoredBlobs(root, courseCode, []string{storageKey})
			}
		}()

		w.WriteHeader(http.StatusAccepted)
	}
}

// writeLocalFile writes r to path, creating parent directories as needed.
func writeLocalFile(path string, r io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}
