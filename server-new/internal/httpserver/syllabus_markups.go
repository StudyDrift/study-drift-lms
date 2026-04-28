package httpserver

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/course"
	"github.com/lextures/lextures/server-new/internal/repos/syllabusmarkups"
)

func encodeSyllabusMarkup(m syllabusmarkups.Markup) map[string]any {
	out := map[string]any{
		"id":        m.ID.String(),
		"kind":      m.Kind,
		"quoteText": m.QuoteText,
		"createdAt": m.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	if m.NotebookPageID != nil {
		out["notebookPageId"] = *m.NotebookPageID
	} else {
		out["notebookPageId"] = nil
	}
	if m.CommentText != nil {
		out["commentText"] = *m.CommentText
	} else {
		out["commentText"] = nil
	}
	return out
}

// handleListSyllabusMarkups is GET /api/v1/courses/{course_code}/syllabus/markups
func (d Deps) handleListSyllabusMarkups() http.HandlerFunc {
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
		courseCode, uid, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to resolve course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		rows, err := syllabusmarkups.ListForUserCourse(r.Context(), d.Pool, uid, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load markups.")
			return
		}
		markups := make([]map[string]any, 0, len(rows))
		for _, m := range rows {
			markups = append(markups, encodeSyllabusMarkup(m))
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"markups": markups})
	}
}

// handleCreateSyllabusMarkup is POST /api/v1/courses/{course_code}/syllabus/markups
func (d Deps) handleCreateSyllabusMarkup() http.HandlerFunc {
	type body struct {
		Kind           string  `json:"kind"`
		QuoteText      string  `json:"quoteText"`
		NotebookPageID *string `json:"notebookPageId"`
		CommentText    *string `json:"commentText"`
	}
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
		courseCode, uid, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		var in body
		if err := json.Unmarshal(b, &in); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if msg := syllabusmarkups.ValidateRequest(strings.TrimSpace(in.Kind), in.QuoteText, in.NotebookPageID, in.CommentText); msg != "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, msg)
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to resolve course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		m, err := syllabusmarkups.Insert(
			r.Context(), d.Pool, uid, *cid, strings.TrimSpace(in.Kind), strings.TrimSpace(in.QuoteText),
			in.NotebookPageID, in.CommentText,
		)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create markup.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(encodeSyllabusMarkup(*m))
	}
}

// handleDeleteSyllabusMarkup is DELETE /api/v1/courses/{course_code}/syllabus/markups/{markup_id}
func (d Deps) handleDeleteSyllabusMarkup() http.HandlerFunc {
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
		courseCode, uid, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		markupID, err := uuid.Parse(chi.URLParam(r, "markup_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid markup id.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to resolve course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		deleted, err := syllabusmarkups.DeleteOwned(r.Context(), d.Pool, uid, *cid, markupID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete markup.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Markup not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
