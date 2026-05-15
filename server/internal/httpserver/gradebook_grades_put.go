package httpserver

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursegrades"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

// handlePutCourseGradebookGrades is PUT /api/v1/courses/{course_code}/gradebook/grades.
func (d Deps) handlePutCourseGradebookGrades() http.HandlerFunc {
	type body struct {
		Grades       map[string]map[string]string             `json:"grades"`
		RubricScores map[string]map[string]map[string]float64 `json:"rubricScores"`
		ChangeReason *string                                  `json:"changeReason"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPut {
			w.Header().Set("Allow", http.MethodPut+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}

		courseCode, viewer, ok := d.requireCourseAccess(w, r)
		if !ok {
			return
		}

		canEdit, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !canEdit {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit grades.")
			return
		}

		payload, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not read body.")
			return
		}

		var b body
		if err := json.Unmarshal(payload, &b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if b.RubricScores != nil {
			for _, row := range b.RubricScores {
				for _, crit := range row {
					if len(crit) > 0 {
						apierr.WriteJSON(w, http.StatusNotImplemented, apierr.CodeNotImplemented, "Rubric score bulk save is not implemented for this endpoint yet.")
						return
					}
				}
			}
		}
		_ = b.ChangeReason // audit trail parity pending

		if len(b.Grades) == 0 {
			w.WriteHeader(http.StatusNoContent)
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

		if err := coursegrades.ApplyGradebookGridPut(r.Context(), d.Pool, *cid, b.Grades); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
