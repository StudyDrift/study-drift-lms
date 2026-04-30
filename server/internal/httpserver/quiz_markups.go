package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	modelmarkups "github.com/lextures/lextures/server/internal/models/contentpagemarkups"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	markuprepo "github.com/lextures/lextures/server/internal/repos/contentpagemarkups"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

// quizMarkupsRequireAccess mirrors Rust `ensure_user_can_view_quiz_for_markups`.
func (d Deps) quizMarkupsRequireAccess(w http.ResponseWriter, r *http.Request, itemID uuid.UUID) (courseID uuid.UUID, viewer uuid.UUID, ok bool) {
	courseCode, viewer, ok := d.requireCourseAccess(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
		return uuid.Nil, uuid.Nil, false
	}
	if cid == nil {
		apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
		return uuid.Nil, uuid.Nil, false
	}
	perm := "course:" + courseCode + ":item:create"
	canEdit, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
		return uuid.Nil, uuid.Nil, false
	}
	if !canEdit {
		visible, err := coursestructure.QuizVisibleToStudent(r.Context(), d.Pool, *cid, itemID, viewer, time.Now().UTC())
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to check quiz access.")
			return uuid.Nil, uuid.Nil, false
		}
		if !visible {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return uuid.Nil, uuid.Nil, false
		}
	}
	return *cid, viewer, true
}

// handleListQuizMarkups is GET /api/v1/courses/{course_code}/quizzes/{item_id}/markups.
func (d Deps) handleListQuizMarkups() http.HandlerFunc {
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
		itemID, err := uuid.Parse(chi.URLParam(r, "item_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid item id.")
			return
		}
		cid, viewer, ok := d.quizMarkupsRequireAccess(w, r, itemID)
		if !ok {
			return
		}
		markups, err := markuprepo.ListForUserItem(r.Context(), d.Pool, viewer, cid, itemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load markups.")
			return
		}
		out := modelmarkups.ContentPageMarkupsListResponse{Markups: markups}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleCreateQuizMarkup is POST /api/v1/courses/{course_code}/quizzes/{item_id}/markups.
func (d Deps) handleCreateQuizMarkup() http.HandlerFunc {
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
		itemID, err := uuid.Parse(chi.URLParam(r, "item_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid item id.")
			return
		}
		cid, viewer, ok := d.quizMarkupsRequireAccess(w, r, itemID)
		if !ok {
			return
		}
		var req modelmarkups.CreateContentPageMarkupRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if err := markuprepo.ValidateMarkupRequest(req.Kind, req.QuoteText, req.NotebookPageID, req.CommentText); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		row, err := markuprepo.Insert(r.Context(), d.Pool, viewer, cid, itemID, "quiz", req.Kind, req.QuoteText, req.NotebookPageID, req.CommentText)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save markup.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(row)
	}
}

// handleDeleteQuizMarkup is DELETE /api/v1/courses/{course_code}/quizzes/{item_id}/markups/{markup_id}.
func (d Deps) handleDeleteQuizMarkup() http.HandlerFunc {
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
		itemID, err := uuid.Parse(chi.URLParam(r, "item_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid item id.")
			return
		}
		markupID, err := uuid.Parse(chi.URLParam(r, "markup_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid markup id.")
			return
		}
		cid, viewer, ok := d.quizMarkupsRequireAccess(w, r, itemID)
		if !ok {
			return
		}
		deleted, err := markuprepo.DeleteOwned(r.Context(), d.Pool, viewer, cid, itemID, markupID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to delete markup.")
			return
		}
		if !deleted {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
