package httpserver

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/coursegrading"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

// handleGetCourseGrading is GET /api/v1/courses/{course_code}/grading (Rust `grading_get_handler`).
// Requires `course:{code}:gradebook:view`.
func (d Deps) handleGetCourseGrading() http.HandlerFunc {
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
		ok, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":gradebook:view")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to view gradebook settings.")
			return
		}
		row, err := coursegrading.GetSettingsForCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load grading settings.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(row)
	}
}

var allowedGradingScales = map[string]struct{}{
	"letter_standard":  {},
	"letter_plus_minus": {},
	"percent":          {},
	"pass_fail":        {},
}

// handlePutCourseGrading is PUT /api/v1/courses/{course_code}/grading (Rust `grading_put_handler`).
// Requires `course:{code}:item:create`.
func (d Deps) handlePutCourseGrading() http.HandlerFunc {
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
		ok, err := rbac.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit grading settings.")
			return
		}
		var raw map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		var req struct {
			GradingScale        string                        `json:"gradingScale"`
			AssignmentGroups   []coursegrading.AssignmentGroupInput `json:"assignmentGroups"`
			SbgEnabled         *bool                         `json:"sbgEnabled"`
			SbgAggregationRule *string                      `json:"sbgAggregationRule"`
		}
		if b, ok := raw["gradingScale"]; ok {
			_ = json.Unmarshal(b, &req.GradingScale)
		}
		if b, ok := raw["assignmentGroups"]; ok {
			_ = json.Unmarshal(b, &req.AssignmentGroups)
		}
		if b, ok := raw["sbgEnabled"]; ok {
			_ = json.Unmarshal(b, &req.SbgEnabled)
		}
		if b, ok := raw["sbgAggregationRule"]; ok {
			_ = json.Unmarshal(b, &req.SbgAggregationRule)
		}
		scale := strings.TrimSpace(req.GradingScale)
		if _, ok := allowedGradingScales[scale]; !ok {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid grading scale.")
			return
		}
		for _, g := range req.AssignmentGroups {
			if strings.TrimSpace(g.Name) == "" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Each assignment group needs a name.")
				return
			}
			wp := g.WeightPercent
			if math.IsNaN(wp) || math.IsInf(wp, 0) || wp < 0 || wp > 100 {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Weights must be between 0 and 100.")
				return
			}
			dl, dh := 0, 0
			if g.DropLowest != nil {
				dl = *g.DropLowest
			}
			if g.DropHighest != nil {
				dh = *g.DropHighest
			}
			if dl < 0 || dl > 500 || dh < 0 || dh > 500 {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "dropLowest and dropHighest must be between 0 and 500.")
				return
			}
		}
		if ar := req.SbgAggregationRule; ar != nil {
			t := strings.TrimSpace(*ar)
			if t != "" && t != "most_recent" && t != "highest" && t != "mean" && t != "decaying_average" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid sbgAggregationRule (use most_recent, highest, mean, or decaying_average).")
				return
			}
		}
		var sbg *coursegrading.PutSbgConfig
		if req.SbgEnabled != nil || raw["sbgProficiencyScaleJson"] != nil || req.SbgAggregationRule != nil {
			sbg = &coursegrading.PutSbgConfig{Enabled: req.SbgEnabled, AggregationRule: req.SbgAggregationRule}
			if b, ok := raw["sbgProficiencyScaleJson"]; ok {
				if string(b) == "null" {
					empty := json.RawMessage("null")
					sbg.ScaleJSON = &empty
				} else {
					cpy := append(json.RawMessage(nil), b...)
					sbg.ScaleJSON = &cpy
				}
			}
		}
		row, err := coursegrading.PutSettings(r.Context(), d.Pool, courseCode, scale, req.AssignmentGroups, sbg)
		if err != nil {
			var p *coursegrading.PutError
			if errors.As(err, &p) && p != nil && p.UnknownID != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, p.Error())
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save grading settings.")
			return
		}
		if row == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(row)
	}
}
