package httpserver

import (
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/coursefiles"
	"github.com/lextures/lextures/server/internal/service/filestorage"
)

// handleGetCourseFileContent is GET /api/v1/courses/{course_code}/course-files/{file_id}/content
func (d Deps) handleGetCourseFileContent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, _, ok := d.requireCourseAccess(w, r)
		if !ok {
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

		cfg := d.effectiveConfig()

		// S3-backed: generate presigned URL and redirect
		if d.Storage != nil {
			ttl := time.Duration(cfg.StoragePresignTTL) * time.Second
			if ttl <= 0 {
				ttl = time.Hour
			}
			presignURL, presignErr := d.Storage.GetPresignedURL(r.Context(), row.StorageKey, ttl)
			if presignErr != nil && !errors.Is(presignErr, filestorage.ErrNoPresignedURL) {
				log.Printf("course-file-content: presign key=%q err=%v", row.StorageKey, presignErr)
				apierr.WriteJSON(w, http.StatusBadGateway, apierr.CodeInternal, "File temporarily unavailable — try again in a moment.")
				return
			}
			if presignURL != "" {
				http.Redirect(w, r, presignURL, http.StatusFound)
				return
			}
			// local driver falls through to disk read below
		}

		// Local driver: serve bytes directly from disk
		root := strings.TrimSpace(cfg.CourseFilesRoot)
		if root == "" {
			root = "data/course-files"
		}
		p := coursefiles.BlobDiskPath(root, courseCode, row.StorageKey)
		b, err := os.ReadFile(p)
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		ct := strings.TrimSpace(row.MimeType)
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(b)
	}
}
