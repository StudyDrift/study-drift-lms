package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/course"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
)

type createCourseBody struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	CourseType  *string `json:"courseType"`
}

// handleCreateCourse is POST /api/v1/courses.
func (d Deps) handleCreateCourse() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}

		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}

		allowed, err := rbac.UserHasPermission(r.Context(), d.Pool, userID, "global:app:course:create")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !allowed {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
			return
		}

		var body createCourseBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}

		title := strings.TrimSpace(body.Title)
		if title == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Course title is required.")
			return
		}

		description := strings.TrimSpace(body.Description)
		courseType := "traditional"
		if body.CourseType != nil {
			courseType = strings.TrimSpace(strings.ToLower(*body.CourseType))
			if courseType == "" {
				courseType = "traditional"
			}
		}
		if courseType != "traditional" && courseType != "competency_based" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "courseType must be traditional or competency_based.")
			return
		}

		out, err := course.CreateCourse(r.Context(), d.Pool, userID, title, description, courseType)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create course.")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(out)
	}
}
