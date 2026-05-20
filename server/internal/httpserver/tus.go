package httpserver

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/apierr"
)

const tusVersion = "1.0.0"

// tusMimeAllowlist defines permitted file types for tus uploads.
var tusMimeAllowlist = map[string]bool{
	"video/mp4": true, "video/webm": true, "video/ogg": true,
	"video/quicktime": true, "video/mpeg": true, "video/x-msvideo": true,
	"audio/mpeg": true, "audio/ogg": true, "audio/wav": true, "audio/mp4": true, "audio/webm": true,
	"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true, "image/svg+xml": true,
	"application/pdf": true, "application/zip": true, "application/x-zip-compressed": true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/vnd.ms-excel": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"application/vnd.ms-powerpoint": true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"text/plain": true, "text/csv": true,
	"application/octet-stream": true,
}

const tusMaxUploadBytes int64 = 10 << 30 // 10 GB

type tusUploadRow struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	CourseID     *uuid.UUID
	ObjectKey    string
	UploadLength int64
	UploadOffset int64
	MimeType     *string
	Filename     *string
	ExpiresAt    time.Time
	CompletedAt  *time.Time
}

func tusTempPath(uploadID uuid.UUID) string {
	return filepath.Join(os.TempDir(), "tus-"+uploadID.String()+".part")
}

func addTusHeaders(w http.ResponseWriter) {
	w.Header().Set("Tus-Resumable", tusVersion)
	w.Header().Set("Tus-Version", tusVersion)
	w.Header().Set("Tus-Extension", "creation,termination")
	w.Header().Set("Tus-Max-Size", strconv.FormatInt(tusMaxUploadBytes, 10))
}

func (d Deps) registerTusRoutes(r chi.Router) {
	r.Post("/api/v1/tus/files", d.handleTusCreate())
	r.Head("/api/v1/tus/files/{upload_id}", d.handleTusHead())
	r.Patch("/api/v1/tus/files/{upload_id}", d.handleTusPatch())
	r.Delete("/api/v1/tus/files/{upload_id}", d.handleTusDelete())
}

// handleTusCreate handles POST /api/v1/tus/files (tus Creation extension).
func (d Deps) handleTusCreate() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		addTusHeaders(w)

		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}

		if r.Header.Get("Tus-Resumable") != tusVersion {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}

		uploadLengthStr := r.Header.Get("Upload-Length")
		if uploadLengthStr == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Upload-Length header required.")
			return
		}
		uploadLength, err := strconv.ParseInt(uploadLengthStr, 10, 64)
		if err != nil || uploadLength < 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid Upload-Length.")
			return
		}
		if uploadLength > tusMaxUploadBytes {
			apierr.WriteJSON(w, http.StatusRequestEntityTooLarge, apierr.CodeInvalidInput, "Upload exceeds maximum size of 10 GB.")
			return
		}

		meta := parseTusMetadata(r.Header.Get("Upload-Metadata"))
		filename := meta["filename"]
		mimeType := meta["filetype"]
		if mimeType == "" {
			mimeType = meta["type"]
		}
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		if !tusMimeAllowlist[mimeType] {
			apierr.WriteJSON(w, http.StatusUnprocessableEntity, apierr.CodeInvalidInput, "File type not permitted.")
			return
		}

		var courseID *uuid.UUID
		if raw := meta["course_id"]; raw != "" {
			if id, parseErr := uuid.Parse(raw); parseErr == nil {
				courseID = &id
			}
		}

		uploadID := uuid.New()
		ext := filepath.Ext(filename)
		objectKey := fmt.Sprintf("uploads/%s/%s%s", userID, uploadID, ext)

		ttlHours := d.effectiveConfig().TusUploadTTLHours
		if ttlHours <= 0 {
			ttlHours = 48
		}
		expiresAt := time.Now().UTC().Add(time.Duration(ttlHours) * time.Hour)

		var nullMime, nullFilename *string
		if mimeType != "" {
			s := mimeType
			nullMime = &s
		}
		if filename != "" {
			s := filename
			nullFilename = &s
		}

		_, dbErr := d.Pool.Exec(r.Context(), `
			INSERT INTO storage.tus_uploads
			  (id, user_id, course_id, object_key, upload_length, mime_type, filename, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			uploadID, userID, courseID, objectKey, uploadLength, nullMime, nullFilename, expiresAt)
		if dbErr != nil {
			slog.Error("tus: create upload", "err", dbErr)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create upload.")
			return
		}

		if uploadLength == 0 {
			_, _ = d.Pool.Exec(r.Context(),
				`UPDATE storage.tus_uploads SET completed_at = now() WHERE id = $1`, uploadID)
		} else {
			if f, createErr := os.Create(tusTempPath(uploadID)); createErr == nil {
				_ = f.Close()
			}
		}

		w.Header().Set("Location", "/api/v1/tus/files/"+uploadID.String())
		w.WriteHeader(http.StatusCreated)
	}
}

// handleTusHead handles HEAD /api/v1/tus/files/:id — reports current upload offset.
func (d Deps) handleTusHead() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		addTusHeaders(w)
		w.Header().Set("Cache-Control", "no-store")

		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}

		uploadID, err := uuid.Parse(chi.URLParam(r, "upload_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Upload not found.")
			return
		}

		upload, loadErr := loadTusUpload(r.Context(), d.Pool, uploadID)
		if loadErr != nil || upload == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Upload not found.")
			return
		}
		if upload.UserID != userID {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}

		// If the temp file is gone but offset > 0 (e.g. after server restart), reset offset
		// so the client knows to re-send from the start.
		offset := upload.UploadOffset
		if offset > 0 {
			if _, statErr := os.Stat(tusTempPath(uploadID)); os.IsNotExist(statErr) {
				offset = 0
			}
		}

		w.Header().Set("Upload-Offset", strconv.FormatInt(offset, 10))
		w.Header().Set("Upload-Length", strconv.FormatInt(upload.UploadLength, 10))
		w.WriteHeader(http.StatusOK)
	}
}

// handleTusPatch handles PATCH /api/v1/tus/files/:id — receives a data chunk.
func (d Deps) handleTusPatch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		addTusHeaders(w)

		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}

		if r.Header.Get("Tus-Resumable") != tusVersion {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		if r.Header.Get("Content-Type") != "application/offset+octet-stream" {
			apierr.WriteJSON(w, http.StatusUnsupportedMediaType, apierr.CodeInvalidInput,
				"Content-Type must be application/offset+octet-stream.")
			return
		}

		offsetStr := r.Header.Get("Upload-Offset")
		if offsetStr == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Upload-Offset header required.")
			return
		}
		offset, err := strconv.ParseInt(offsetStr, 10, 64)
		if err != nil || offset < 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid Upload-Offset.")
			return
		}

		uploadID, err := uuid.Parse(chi.URLParam(r, "upload_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Upload not found.")
			return
		}

		upload, loadErr := loadTusUpload(r.Context(), d.Pool, uploadID)
		if loadErr != nil || upload == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Upload not found.")
			return
		}
		if upload.UserID != userID {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}
		if upload.CompletedAt != nil {
			apierr.WriteJSON(w, http.StatusConflict, apierr.CodeConflict, "Upload already completed.")
			return
		}
		if time.Now().UTC().After(upload.ExpiresAt) {
			apierr.WriteJSON(w, http.StatusGone, apierr.CodeInvalidInput, "Upload has expired.")
			return
		}
		if offset != upload.UploadOffset {
			w.Header().Set("Upload-Offset", strconv.FormatInt(upload.UploadOffset, 10))
			apierr.WriteJSON(w, http.StatusConflict, apierr.CodeConflict, "Upload-Offset mismatch.")
			return
		}

		tmpPath := tusTempPath(uploadID)
		f, openErr := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE, 0o644)
		if openErr != nil {
			slog.Error("tus: open temp file", "upload_id", uploadID, "err", openErr)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to write chunk.")
			return
		}
		if _, seekErr := f.Seek(offset, io.SeekStart); seekErr != nil {
			_ = f.Close()
			slog.Error("tus: seek", "upload_id", uploadID, "err", seekErr)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to write chunk.")
			return
		}
		written, copyErr := io.Copy(f, r.Body)
		closeErr := f.Close()
		if copyErr != nil {
			slog.Error("tus: copy chunk", "upload_id", uploadID, "err", copyErr)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to write chunk.")
			return
		}
		if closeErr != nil {
			slog.Error("tus: close temp file", "upload_id", uploadID, "err", closeErr)
		}

		newOffset := offset + written
		if _, dbErr := d.Pool.Exec(r.Context(),
			`UPDATE storage.tus_uploads SET upload_offset = $1, updated_at = now() WHERE id = $2`,
			newOffset, uploadID); dbErr != nil {
			slog.Error("tus: update offset", "upload_id", uploadID, "err", dbErr)
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update offset.")
			return
		}

		if newOffset >= upload.UploadLength {
			if finalErr := d.finalizeTusUpload(uploadID, upload, tmpPath); finalErr != nil {
				slog.Error("tus: finalize", "upload_id", uploadID, "err", finalErr)
			}
		}

		w.Header().Set("Upload-Offset", strconv.FormatInt(newOffset, 10))
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleTusDelete handles DELETE /api/v1/tus/files/:id (tus Termination extension).
func (d Deps) handleTusDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		addTusHeaders(w)

		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}

		uploadID, err := uuid.Parse(chi.URLParam(r, "upload_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Upload not found.")
			return
		}

		upload, loadErr := loadTusUpload(r.Context(), d.Pool, uploadID)
		if loadErr != nil || upload == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Upload not found.")
			return
		}
		if upload.UserID != userID {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Access denied.")
			return
		}

		_ = os.Remove(tusTempPath(uploadID))
		_, _ = d.Pool.Exec(r.Context(), `DELETE FROM storage.tus_uploads WHERE id = $1`, uploadID)
		w.WriteHeader(http.StatusNoContent)
	}
}

// finalizeTusUpload persists the assembled temp file via the storage driver and marks the upload complete.
func (d Deps) finalizeTusUpload(uploadID uuid.UUID, upload *tusUploadRow, tmpPath string) error {
	ctx := context.Background()

	if d.Storage != nil {
		f, openErr := os.Open(tmpPath)
		if openErr != nil {
			return fmt.Errorf("open temp file: %w", openErr)
		}
		mime := "application/octet-stream"
		if upload.MimeType != nil {
			mime = *upload.MimeType
		}
		putErr := d.Storage.PutObject(ctx, upload.ObjectKey, f, upload.UploadLength, mime)
		_ = f.Close()
		if putErr != nil {
			return fmt.Errorf("put object: %w", putErr)
		}
	}

	if _, dbErr := d.Pool.Exec(ctx,
		`UPDATE storage.tus_uploads SET completed_at = now(), updated_at = now() WHERE id = $1`,
		uploadID); dbErr != nil {
		return fmt.Errorf("mark complete: %w", dbErr)
	}

	_ = os.Remove(tmpPath)
	slog.Info("tus: upload complete",
		"upload_id", uploadID,
		"object_key", upload.ObjectKey,
		"bytes", upload.UploadLength,
	)
	return nil
}

// loadTusUpload retrieves a tus_uploads row by ID. Returns nil, nil when not found.
func loadTusUpload(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*tusUploadRow, error) {
	var u tusUploadRow
	err := pool.QueryRow(ctx, `
		SELECT id, user_id, course_id, object_key, upload_length, upload_offset,
		       mime_type, filename, expires_at, completed_at
		FROM storage.tus_uploads
		WHERE id = $1`, id).Scan(
		&u.ID, &u.UserID, &u.CourseID, &u.ObjectKey, &u.UploadLength, &u.UploadOffset,
		&u.MimeType, &u.Filename, &u.ExpiresAt, &u.CompletedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// parseTusMetadata decodes an Upload-Metadata header value per tus 1.0 spec.
// Format: "key base64val, key2 base64val2, ..."
func parseTusMetadata(s string) map[string]string {
	out := make(map[string]string)
	for _, pair := range strings.Split(s, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		parts := strings.SplitN(pair, " ", 2)
		key := strings.TrimSpace(parts[0])
		if key == "" {
			continue
		}
		if len(parts) == 2 {
			if dec, decErr := base64.StdEncoding.DecodeString(strings.TrimSpace(parts[1])); decErr == nil {
				out[key] = string(dec)
			}
		} else {
			out[key] = ""
		}
	}
	return out
}
