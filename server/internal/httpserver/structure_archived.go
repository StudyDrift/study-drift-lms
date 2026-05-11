package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/courseroles"
)

// handleCourseStructureArchived is GET /api/v1/courses/{course_code}/structure/archived.
func (d Deps) handleCourseStructureArchived() http.HandlerFunc {
	type resp struct {
		Items []coursestructure.ItemResponse `json:"items"`
	}
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
		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}
		canEdit, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canEdit {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
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
		rows, err := coursestructure.ListArchivedStaffStructure(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load archived structure.")
			return
		}
		items, err := coursestructure.RowsToResponsesWithQuizAdaptive(r.Context(), d.Pool, *cid, rows)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load archived structure.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp{Items: items})
	}
}

