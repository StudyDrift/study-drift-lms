package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/authz"
	"github.com/lextures/lextures/server/internal/models/search"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursegrants"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

func (d Deps) handleSearchIndex() http.HandlerFunc {
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
		courses, err := course.ListForSearchIndex(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Search failed.")
			return
		}
		peopleRaw, err := enrollment.ListPeopleForEnrolledCourses(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Search failed.")
			return
		}
		grants, err := rbac.ListGrantedPermissionStrings(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Search failed.")
			return
		}
		people := filterSearchPeopleByRosterRead(grants, peopleRaw)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(search.IndexResponse{
			Courses: courses,
			People:  people,
		})
	}
}

func filterSearchPeopleByRosterRead(grants []string, in []search.PersonItem) []search.PersonItem {
	if len(in) == 0 {
		return in
	}
	var out []search.PersonItem
	for _, p := range in {
		req := coursegrants.CourseEnrollmentsReadPermission(p.CourseCode)
		if authz.AnyGrantMatch(grants, req) {
			out = append(out, p)
		}
	}
	return out
}
