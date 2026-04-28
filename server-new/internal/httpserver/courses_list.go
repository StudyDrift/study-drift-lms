package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/course"
)

type coursesListResponse struct {
	Courses []course.CoursePublic `json:"courses"`
}

func (d Deps) handleListCourses() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		courses, err := course.ListForEnrolledUser(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
			return
		}
		if courses == nil {
			courses = []course.CoursePublic{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(coursesListResponse{Courses: courses})
	}
}
