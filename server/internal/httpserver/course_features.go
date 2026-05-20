package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/courseroles"
)

type patchCourseFeaturesBody struct {
	NotebookEnabled               bool  `json:"notebookEnabled"`
	FeedEnabled                   bool  `json:"feedEnabled"`
	CalendarEnabled               bool  `json:"calendarEnabled"`
	QuestionBankEnabled           bool  `json:"questionBankEnabled"`
	LockdownModeEnabled           bool  `json:"lockdownModeEnabled"`
	StandardsAlignmentEnabled     *bool `json:"standardsAlignmentEnabled"`
	AdaptivePathsEnabled          *bool `json:"adaptivePathsEnabled"`
	SRSEnabled                    *bool `json:"srsEnabled"`
	DiagnosticAssessmentsEnabled  *bool `json:"diagnosticAssessmentsEnabled"`
	HintScaffoldingEnabled        *bool `json:"hintScaffoldingEnabled"`
	MisconceptionDetectionEnabled *bool `json:"misconceptionDetectionEnabled"`
	SectionsEnabled               *bool `json:"sectionsEnabled"`
	DiscussionsEnabled            bool  `json:"discussionsEnabled"`
	CollabDocsEnabled             *bool `json:"collabDocsEnabled"`
	LiveSessionsEnabled           *bool `json:"liveSessionsEnabled"`
	GroupSpacesEnabled            *bool `json:"groupSpacesEnabled"`
	OfficeHoursEnabled            *bool `json:"officeHoursEnabled"`
	AiTutorEnabled                *bool `json:"aiTutorEnabled"`
}

// handlePatchCourseFeatures is PATCH /api/v1/courses/{course_code}/features.
func (d Deps) handlePatchCourseFeatures() http.HandlerFunc {
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
		hasPerm, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":item:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !hasPerm {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}
		var req patchCourseFeaturesBody
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		existing, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if existing == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		standards := existing.StandardsAlignmentEnabled
		if req.StandardsAlignmentEnabled != nil {
			standards = *req.StandardsAlignmentEnabled
		}
		adaptivePaths := existing.AdaptivePathsEnabled
		if req.AdaptivePathsEnabled != nil {
			adaptivePaths = *req.AdaptivePathsEnabled
		}
		srs := existing.SRSEnabled
		if req.SRSEnabled != nil {
			srs = *req.SRSEnabled
		}
		diagnostic := existing.DiagnosticAssessmentsEnabled
		if req.DiagnosticAssessmentsEnabled != nil {
			diagnostic = *req.DiagnosticAssessmentsEnabled
		}
		hint := existing.HintScaffoldingEnabled
		if req.HintScaffoldingEnabled != nil {
			hint = *req.HintScaffoldingEnabled
		}
		misconception := existing.MisconceptionDetectionEnabled
		if req.MisconceptionDetectionEnabled != nil {
			misconception = *req.MisconceptionDetectionEnabled
		}
		collabDocs := existing.CollabDocsEnabled
		if req.CollabDocsEnabled != nil {
			collabDocs = *req.CollabDocsEnabled
		}
		liveSessions := existing.LiveSessionsEnabled
		if req.LiveSessionsEnabled != nil {
			liveSessions = *req.LiveSessionsEnabled
		}
		groupSpaces := existing.GroupSpacesEnabled
		if req.GroupSpacesEnabled != nil {
			groupSpaces = *req.GroupSpacesEnabled
		}
		officeHours := existing.OfficeHoursEnabled
		if req.OfficeHoursEnabled != nil {
			officeHours = *req.OfficeHoursEnabled
		}
		aiTutor := existing.AiTutorEnabled
		if req.AiTutorEnabled != nil {
			aiTutor = *req.AiTutorEnabled
		}

		out, err := course.PatchFeatures(
			r.Context(), d.Pool, courseCode,
			req.NotebookEnabled, req.FeedEnabled, req.CalendarEnabled, req.QuestionBankEnabled,
			req.LockdownModeEnabled, standards, adaptivePaths, srs, diagnostic, hint, misconception,
			req.DiscussionsEnabled, collabDocs, liveSessions, groupSpaces, officeHours, aiTutor,
		)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to patch course features.")
			return
		}
		if out == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		if req.SectionsEnabled != nil {
			out2, err := course.SetSectionsEnabled(r.Context(), d.Pool, courseCode, *req.SectionsEnabled)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update sections setting.")
				return
			}
			if out2 != nil {
				out = out2
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(out)
	}
}
