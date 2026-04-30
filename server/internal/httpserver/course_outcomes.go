package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

type courseOutcomesListResponse struct {
	EnrolledLearners int                `json:"enrolledLearners"`
	Outcomes         []courseOutcomeAPI `json:"outcomes"`
}

type courseOutcomeAPI struct {
	ID                    string                 `json:"id"`
	Title                 string                 `json:"title"`
	Description           string                 `json:"description"`
	SortOrder             int                    `json:"sortOrder"`
	RollupAvgScorePercent *float64               `json:"rollupAvgScorePercent"`
	Links                 []courseOutcomeLinkAPI `json:"links"`
}

type courseOutcomeLinkAPI struct {
	ID               string                  `json:"id"`
	SubOutcomeID     *string                 `json:"subOutcomeId,omitempty"`
	StructureItemID  string                  `json:"structureItemId"`
	TargetKind       string                  `json:"targetKind"`
	QuizQuestionID   string                  `json:"quizQuestionId"`
	MeasurementLevel string                  `json:"measurementLevel"`
	IntensityLevel   string                  `json:"intensityLevel"`
	ItemTitle        string                  `json:"itemTitle"`
	ItemKind         string                  `json:"itemKind"`
	Progress         courseOutcomeLinkProgress `json:"progress"`
}

type courseOutcomeLinkProgress struct {
	AvgScorePercent *float64 `json:"avgScorePercent"`
	GradedLearners  int      `json:"gradedLearners"`
	EnrolledLearners int     `json:"enrolledLearners"`
}

// handleCourseOutcomesList is GET /api/v1/courses/{course_code}/outcomes.
// Full outcomes repo parity is still in progress; until then this returns an empty, schema-valid payload.
func (d Deps) handleCourseOutcomesList() http.HandlerFunc {
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
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to view outcomes.")
			return
		}

		out := courseOutcomesListResponse{
			EnrolledLearners: 0,
			Outcomes:         []courseOutcomeAPI{},
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

