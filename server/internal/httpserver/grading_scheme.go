package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/gradingdisplay"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/gradingschemes"
	"github.com/lextures/lextures/server/internal/courseroles"
)

type gradingSchemeResponse struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Type      string          `json:"type"`
	ScaleJSON json.RawMessage `json:"scaleJson"`
}

type courseGradingSchemeEnvelope struct {
	Scheme *gradingSchemeResponse `json:"scheme"`
}

type putGradingSchemeBody struct {
	Name      *string          `json:"name"`
	Type      string           `json:"type"`
	ScaleJSON *json.RawMessage `json:"scaleJson"`
}

// handleGetCourseGradingScheme is GET /api/v1/courses/{course_code}/grading-scheme.
func (d Deps) handleGetCourseGradingScheme() http.HandlerFunc {
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
		perm := "course:" + courseCode + ":gradebook:view"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to view grading scheme.")
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
		row, err := gradingschemes.GetActiveForCourse(r.Context(), d.Pool, *cid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load grading scheme.")
			return
		}
		out := courseGradingSchemeEnvelope{Scheme: nil}
		if row != nil {
			scale := json.RawMessage(`{}`)
			if row.ScaleJSON != nil && len(*row.ScaleJSON) > 0 {
				scale = append(json.RawMessage(nil), (*row.ScaleJSON)...)
			}
			out.Scheme = &gradingSchemeResponse{
				ID:        row.ID.String(),
				Name:      row.Name,
				Type:      row.GradingDisplayType,
				ScaleJSON: scale,
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

// handlePutCourseGradingScheme is PUT /api/v1/courses/{course_code}/grading-scheme.
func (d Deps) handlePutCourseGradingScheme() http.HandlerFunc {
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
		perm := "course:" + courseCode + ":item:create"
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, perm)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to edit grading scheme.")
			return
		}

		var body putGradingSchemeBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		kind, kindOK := gradingdisplay.ParseKind(strings.TrimSpace(body.Type))
		if !kindOK {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid grading scheme type.")
			return
		}
		name := "Default"
		if body.Name != nil {
			name = strings.TrimSpace(*body.Name)
		}
		if name == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Scheme name cannot be empty.")
			return
		}
		scale := normalizeScaleForStorage(kind, body.ScaleJSON)
		if _, err := gradingdisplay.ParseScale(kind, &scale); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, err.Error())
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
		row, err := gradingschemes.UpsertForCourse(r.Context(), d.Pool, *cid, name, kind.String(), scale)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save grading scheme.")
			return
		}
		scaleOut := json.RawMessage(`{}`)
		if row.ScaleJSON != nil && len(*row.ScaleJSON) > 0 {
			scaleOut = append(json.RawMessage(nil), (*row.ScaleJSON)...)
		}
		out := courseGradingSchemeEnvelope{
			Scheme: &gradingSchemeResponse{
				ID:        row.ID.String(),
				Name:      row.Name,
				Type:      row.GradingDisplayType,
				ScaleJSON: scaleOut,
			},
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func normalizeScaleForStorage(kind gradingdisplay.Kind, in *json.RawMessage) json.RawMessage {
	// Points and percentage ignore custom scales; Rust stores `{}` for these kinds.
	if kind == gradingdisplay.Points || kind == gradingdisplay.Percentage {
		return json.RawMessage(`{}`)
	}
	if in == nil || len(*in) == 0 {
		return json.RawMessage(`{}`)
	}
	return append(json.RawMessage(nil), (*in)...)
}

