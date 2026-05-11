package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/courseroles"
)

// handlePatchCourseStructureItem is PATCH /api/v1/courses/{course_code}/structure/items/{item_id}
// (Rust `patch_structure_item_handler` — child items only, requires course:{code}:item:create).
func (d Deps) handlePatchCourseStructureItem() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		ok, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit course structure.")
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "item_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid item id.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		locked, found, err := coursestructure.ItemBlueprintLockState(r.Context(), d.Pool, *cid, itemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify structure item.")
			return
		}
		if found && locked {
			cOrg, err := course.CourseOrgID(r.Context(), d.Pool, courseCode)
			if err != nil || cOrg == nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course.")
				return
			}
			if !d.userCanManageBlueprintLocks(r.Context(), viewer, *cOrg) {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "This item is managed by the district blueprint.")
				return
			}
		}
		var body struct {
			Title     *string `json:"title"`
			Published *bool   `json:"published"`
			Archived  *bool   `json:"archived"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if body.Title == nil && body.Published == nil && body.Archived == nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Provide title, published, and/or archived.")
			return
		}
		var title *string
		if body.Title != nil {
			t := strings.TrimSpace(*body.Title)
			if t == "" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Title cannot be empty.")
				return
			}
			title = &t
		}
		row, err := coursestructure.PatchChildStructureItem(
			r.Context(), d.Pool, *cid, itemID, title, body.Published, body.Archived,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Structure item not found.")
			return
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update structure item.")
			return
		}
		out, err := coursestructure.ItemResponseForRow(r.Context(), d.Pool, *cid, row)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load structure item.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handleDeleteCourseStructureItem is DELETE /api/v1/courses/{course_code}/structure/items/{item_id} (archives a child item).
func (d Deps) handleDeleteCourseStructureItem() http.HandlerFunc {
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
		ok, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit course structure.")
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "item_id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid item id.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		locked, found, err := coursestructure.ItemBlueprintLockState(r.Context(), d.Pool, *cid, itemID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify structure item.")
			return
		}
		if found && locked {
			cOrg, err := course.CourseOrgID(r.Context(), d.Pool, courseCode)
			if err != nil || cOrg == nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course.")
				return
			}
			if !d.userCanManageBlueprintLocks(r.Context(), viewer, *cOrg) {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "This item is managed by the district blueprint.")
				return
			}
		}
		err = coursestructure.ArchiveChildStructureItem(r.Context(), d.Pool, *cid, itemID)
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Structure item not found.")
			return
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to archive structure item.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
