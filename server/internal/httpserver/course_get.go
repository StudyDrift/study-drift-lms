package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursesections"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
)

// courseGetResponse matches Rust `CourseWithViewerResponse` (flattened course + viewer fields).
type courseGetResponse struct {
	course.CoursePublic
	ViewerEnrollmentRoles       []string `json:"viewerEnrollmentRoles"`
	ViewerStudentEnrollmentID   *string  `json:"viewerStudentEnrollmentId,omitempty"`
	ViewerSectionCode           *string  `json:"viewerSectionCode,omitempty"`
	ViewerSectionName           *string  `json:"viewerSectionName,omitempty"`
	AnnotationsEnabled          bool     `json:"annotationsEnabled"`
	FeedbackMediaEnabled        bool     `json:"feedbackMediaEnabled"`
	ResubmissionWorkflowEnabled bool     `json:"resubmissionWorkflowEnabled"`
}

func (d Deps) handleGetCourse() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		courseCode := chi.URLParam(r, "course_code")
		if courseCode == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		hasAccess, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify course access.")
			return
		}
		if !hasAccess {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		crow, err := course.GetPublicByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		if crow == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		cid, err := uuid.Parse(crow.ID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Invalid course id.")
			return
		}
		roles, err := enrollment.UserRolesInCourse(r.Context(), d.Pool, courseCode, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollment roles.")
			return
		}
		if roles == nil {
			roles = []string{}
		}
		stuEid, err := enrollment.GetStudentEnrollmentID(r.Context(), d.Pool, cid, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollment.")
			return
		}
		var stuStr *string
		if stuEid != nil {
			s := stuEid.String()
			stuStr = &s
		}
		var viewerSecCode, viewerSecName *string
		if crow.SectionsEnabled {
			secID, err := enrollment.GetStudentSectionID(r.Context(), d.Pool, cid, userID)
			if err == nil && secID != nil {
				sec, err := coursesections.GetByID(r.Context(), d.Pool, cid, *secID)
				if err == nil && sec != nil {
					c := sec.SectionCode
					viewerSecCode = &c
					if sec.Name != nil && *sec.Name != "" {
						viewerSecName = sec.Name
					}
				}
			}
		}
		resp := courseGetResponse{
			CoursePublic:                *crow,
			ViewerEnrollmentRoles:       roles,
			ViewerStudentEnrollmentID:   stuStr,
			ViewerSectionCode:           viewerSecCode,
			ViewerSectionName:           viewerSecName,
			AnnotationsEnabled:          d.effectiveConfig().AnnotationEnabled,
			FeedbackMediaEnabled:        d.effectiveConfig().FeedbackMediaEnabled,
			ResubmissionWorkflowEnabled: d.effectiveConfig().ResubmissionWorkflowEnabled,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
