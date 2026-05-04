package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/orgunit"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/rbac"
	"github.com/lextures/lextures/server/internal/repos/terms"
)

type createCourseBody struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	CourseType  *string `json:"courseType"`
	OrgUnitID   *string `json:"orgUnitId"`
	TermID      *string `json:"termId"`
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

		ctx := r.Context()
		uOrg, err := organization.OrgIDForUser(ctx, d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify organization.")
			return
		}
		var orgUnitID *uuid.UUID
		if body.OrgUnitID != nil && strings.TrimSpace(*body.OrgUnitID) != "" {
			uid, err := uuid.Parse(strings.TrimSpace(*body.OrgUnitID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid orgUnitId.")
				return
			}
			row, err := orgunit.GetByID(ctx, d.Pool, uid)
			if err != nil || row == nil || row.OrgID != uOrg {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid org unit.")
				return
			}
			ga, err := rbac.UserHasPermission(ctx, d.Pool, userID, permGlobalRBACManage)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
				return
			}
			if !ga {
				subtrees, err := orgunit.ListSubtreeIDsForUserOrgUnitAdmin(ctx, d.Pool, userID, uOrg)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify unit scope.")
					return
				}
				ok := false
				for _, id := range subtrees {
					if id == uid {
						ok = true
						break
					}
				}
				if !ok {
					apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to assign this org unit.")
					return
				}
			}
			orgUnitID = &uid
		}

		var termIDPtr *uuid.UUID
		if body.TermID != nil && strings.TrimSpace(*body.TermID) != "" {
			tid, err := uuid.Parse(strings.TrimSpace(*body.TermID))
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid termId.")
				return
			}
			trow, err := terms.GetByID(ctx, d.Pool, tid)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify term.")
				return
			}
			if trow == nil || trow.OrgID != uOrg.String() {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid term for your organization.")
				return
			}
			termIDPtr = &tid
		}

		out, err := course.CreateCourse(ctx, d.Pool, userID, title, description, courseType, orgUnitID, termIDPtr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create course.")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(out)
	}
}
