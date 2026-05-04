package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/orgunit"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/rbac"
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
		ctx := r.Context()
		courses, err := course.ListForEnrolledUser(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
			return
		}
		ga, err := rbac.UserHasPermission(ctx, d.Pool, userID, permGlobalRBACManage)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
			return
		}
		if !ga {
			orgID, err := organization.OrgIDForUser(ctx, d.Pool, userID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
				return
			}
			subtrees, err := orgunit.ListSubtreeIDsForUserOrgUnitAdmin(ctx, d.Pool, userID, orgID)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
				return
			}
			if len(subtrees) > 0 {
				unitScoped, err := course.ListForEnrolledUserInOrgUnits(ctx, d.Pool, userID, subtrees)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
					return
				}
				courses = unitScoped
			}
		}
		if courses == nil {
			courses = []course.CoursePublic{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(coursesListResponse{Courses: courses})
	}
}
