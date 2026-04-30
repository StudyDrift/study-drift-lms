package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursegrants"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/qtiimport"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

func (d Deps) handleQTIImportStart() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		ct := r.Header.Get("Content-Type")
		if !strings.HasPrefix(ct, "multipart/form-data") {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Expected multipart/form-data.")
			return
		}
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid multipart form.")
			return
		}
		cidStr := strings.TrimSpace(r.FormValue("course_id"))
		if cidStr == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "course_id is required.")
			return
		}
		courseID, err := uuid.Parse(cidStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "course_id must be a UUID.")
			return
		}
		courseCode, err := course.GetCourseCodeByID(r.Context(), d.Pool, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if courseCode == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, *courseCode, viewer)
		if err != nil || !has {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		perm := coursegrants.CourseItemsCreatePermission(*courseCode)
		can, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil || !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		qb, qti, err := course.GetImportFlags(r.Context(), d.Pool, courseID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load import flags.")
			return
		}
		if !qb {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Question bank is not enabled for this course.")
			return
		}
		if !qti {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "QTI import is not enabled for this course.")
			return
		}
		_, h, err := r.FormFile("file")
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "file is required.")
			return
		}
		filename := h.Filename
		f, err := h.Open()
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not read file.")
			return
		}
		b, err := io.ReadAll(f)
		_ = f.Close()
		if err != nil || len(b) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "file is empty.")
			return
		}
		importType := "qti21"
		if strings.HasSuffix(strings.ToLower(filename), ".imscc") {
			importType = "common_cartridge"
		}
		job, err := qtiimport.InsertImportJob(r.Context(), d.Pool, courseID, importType, filename, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to start import job.")
			return
		}
		_ = b // stored for future parser; worker records placeholder status
		go d.runQTIImportJob(job.ID)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]string{"jobId": job.ID.String()})
	}
}

func (d Deps) runQTIImportJob(jobID uuid.UUID) {
	if d.Pool == nil {
		return
	}
	ctx := context.Background()
	_ = qtiimport.MarkJobRunning(ctx, d.Pool, jobID)
	log := []map[string]string{{"message": "QTI / cartridge parse pipeline: job recorded; full import worker is not yet complete in the Go server."}}
	raw, _ := json.Marshal(log)
	_ = qtiimport.MarkJobDone(ctx, d.Pool, jobID, 0, 0, 0, 0, raw)
}

func (d Deps) handleImportStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "job_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid job id.")
			return
		}
		row, err := qtiimport.GetImportJob(r.Context(), d.Pool, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load job.")
			return
		}
		if row == nil || row.CreatedBy != viewer {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":         row.Status,
			"totalItems":     row.TotalItems,
			"processedItems": row.ProcessedItems,
			"succeededItems": row.SucceededItems,
			"failedItems":    row.FailedItems,
			"skippedItems":   row.SkippedItems,
			"errorLog":       json.RawMessage(row.ErrorLog),
			"completedAt":    row.CompletedAt,
		})
	}
}

func (d Deps) handleListImports() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		limit := int64(50)
		var courseID *uuid.UUID
		if s := r.URL.Query().Get("course_id"); s != "" {
			u, err := uuid.Parse(s)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid course_id.")
				return
			}
			courseID = &u
		}
		rows, err := qtiimport.ListImportJobsForUser(r.Context(), d.Pool, viewer, courseID, limit)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list imports.")
			return
		}
		imports := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			imports = append(imports, map[string]any{
				"id":               row.ID.String(),
				"courseId":         row.CourseID.String(),
				"importType":       row.ImportType,
				"originalFilename": row.OriginalFilename,
				"status":           row.Status,
				"totalItems":       row.TotalItems,
				"processedItems":   row.ProcessedItems,
				"succeededItems":   row.SucceededItems,
				"failedItems":      row.FailedItems,
				"skippedItems":     row.SkippedItems,
				"createdAt":        row.CreatedAt,
				"completedAt":      row.CompletedAt,
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"imports": imports})
	}
}
