package httpserver

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursegrades"
	"github.com/lextures/lextures/server/internal/repos/coursestructure"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/parentlinks"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func (d Deps) forbidParentViewerCourseWork(w http.ResponseWriter, r *http.Request, viewer uuid.UUID) bool {
	row, err := user.FindByID(r.Context(), d.Pool, viewer)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load user.")
		return true
	}
	if row != nil && row.AccountType == user.AccountTypeParent {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Parent accounts cannot submit course work.")
		return true
	}
	return false
}

func (d Deps) requireParentViewer(w http.ResponseWriter, r *http.Request) (parentID, orgID uuid.UUID, ok bool) {
	uid, ok := d.meUserID(w, r)
	if !ok {
		return uuid.UUID{}, uuid.UUID{}, false
	}
	row, err := user.FindByID(r.Context(), d.Pool, uid)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load user.")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	if row == nil || row.AccountType != user.AccountTypeParent {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Parent account required.")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	oid, err := organization.OrgIDForUser(r.Context(), d.Pool, uid)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load organization.")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	return uid, oid, true
}

func (d Deps) parseStudentIDParam(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	s := strings.TrimSpace(chi.URLParam(r, "sid"))
	if s == "" {
		s = strings.TrimSpace(chi.URLParam(r, "studentId"))
	}
	id, err := uuid.Parse(s)
	if err != nil {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid student id.")
		return uuid.UUID{}, false
	}
	return id, true
}

func (d Deps) requireParentLink(w http.ResponseWriter, r *http.Request, parentID, orgID, studentID uuid.UUID) (*parentlinks.Link, bool) {
	ln, err := parentlinks.ActiveLinkBetween(r.Context(), d.Pool, orgID, parentID, studentID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify parent link.")
		return nil, false
	}
	if ln == nil {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "No active link to this student.")
		return nil, false
	}
	return ln, true
}

func (d Deps) markUserAsParentAccount(ctx context.Context, parentID uuid.UUID) error {
	_, err := d.Pool.Exec(ctx, `UPDATE "user".users SET account_type = 'parent' WHERE id = $1`, parentID)
	return err
}

// handleParentChildren is GET /api/v1/parent/children
func (d Deps) handleParentChildren() http.HandlerFunc {
	type childOut struct {
		LinkID        string  `json:"linkId"`
		StudentUserID string  `json:"studentUserId"`
		DisplayName   *string `json:"displayName"`
		Email         string  `json:"email"`
		Relationship  string  `json:"relationship"`
		Status        string  `json:"status"`
		LinkedAt      string  `json:"linkedAt"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		parentID, orgID, ok := d.requireParentViewer(w, r)
		if !ok {
			return
		}
		rows, err := parentlinks.ListChildrenForParent(r.Context(), d.Pool, parentID, orgID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list linked students.")
			return
		}
		out := make([]childOut, 0, len(rows))
		for _, ln := range rows {
			out = append(out, childOut{
				LinkID:        ln.ID.String(),
				StudentUserID: ln.StudentUserID.String(),
				DisplayName:   ln.StudentDisplay,
				Email:         ln.StudentEmail,
				Relationship:  ln.Relationship,
				Status:        ln.Status,
				LinkedAt:      ln.LinkedAt.UTC().Format(time.RFC3339Nano),
			})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"children": out})
	}
}

// handleParentStudentCourses is GET /api/v1/parent/students/{sid}/courses
func (d Deps) handleParentStudentCourses() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		parentID, orgID, ok := d.requireParentViewer(w, r)
		if !ok {
			return
		}
		studentID, ok := d.parseStudentIDParam(w, r)
		if !ok {
			return
		}
		if _, ok := d.requireParentLink(w, r, parentID, orgID, studentID); !ok {
			return
		}
		courses, err := course.ListForEnrolledUser(r.Context(), d.Pool, studentID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"courses": courses})
	}
}

// handleParentStudentGrades is GET /api/v1/parent/students/{sid}/grades
func (d Deps) handleParentStudentGrades() http.HandlerFunc {
	type courseGrades struct {
		CourseCode string            `json:"courseCode"`
		Title      string            `json:"title"`
		Grades     map[string]string `json:"grades"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		parentID, orgID, ok := d.requireParentViewer(w, r)
		if !ok {
			return
		}
		studentID, ok := d.parseStudentIDParam(w, r)
		if !ok {
			return
		}
		if _, ok := d.requireParentLink(w, r, parentID, orgID, studentID); !ok {
			return
		}
		courses, err := course.ListForEnrolledUser(r.Context(), d.Pool, studentID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
			return
		}
		out := make([]courseGrades, 0, len(courses))
		for _, c := range courses {
			cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, c.CourseCode)
			if err != nil || cid == nil {
				continue
			}
			gmap, _, _, _, err := coursegrades.ListForCourse(r.Context(), d.Pool, *cid)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load grades.")
				return
			}
			row := gmap[studentID.String()]
			if row == nil {
				row = map[string]string{}
			}
			title := c.Title
			if title == "" {
				title = c.CourseCode
			}
			out = append(out, courseGrades{CourseCode: c.CourseCode, Title: title, Grades: row})
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"courses": out})
	}
}

// handleParentStudentAssignments is GET /api/v1/parent/students/{sid}/assignments
func (d Deps) handleParentStudentAssignments() http.HandlerFunc {
	type itemOut struct {
		CourseCode  string  `json:"courseCode"`
		CourseTitle string  `json:"courseTitle"`
		ItemID      string  `json:"itemId"`
		Kind        string  `json:"kind"`
		Title       string  `json:"title"`
		DueAt       *string `json:"dueAt,omitempty"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		parentID, orgID, ok := d.requireParentViewer(w, r)
		if !ok {
			return
		}
		studentID, ok := d.parseStudentIDParam(w, r)
		if !ok {
			return
		}
		if _, ok := d.requireParentLink(w, r, parentID, orgID, studentID); !ok {
			return
		}
		courses, err := course.ListForEnrolledUser(r.Context(), d.Pool, studentID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list courses.")
			return
		}
		var items []itemOut
		for _, c := range courses {
			cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, c.CourseCode)
			if err != nil || cid == nil {
				continue
			}
			structItems, err := coursestructure.ListForCourseWithEnrichment(r.Context(), d.Pool, *cid, false)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course structure.")
				return
			}
			title := c.Title
			if title == "" {
				title = c.CourseCode
			}
			for _, it := range structItems {
				if it.Kind != "assignment" && it.Kind != "quiz" {
					continue
				}
				if it.Archived || !it.Published {
					continue
				}
				var due *string
				if it.DueAt != nil {
					s := it.DueAt.UTC().Format(time.RFC3339Nano)
					due = &s
				}
				items = append(items, itemOut{
					CourseCode:  c.CourseCode,
					CourseTitle: title,
					ItemID:      it.ID,
					Kind:        it.Kind,
					Title:       it.Title,
					DueAt:       due,
				})
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"assignments": items})
	}
}

func (d Deps) assertSameOrgUsers(ctx context.Context, w http.ResponseWriter, orgID, userA, userB uuid.UUID) bool {
	oa, err := organization.OrgIDForUser(ctx, d.Pool, userA)
	if err != nil || oa != orgID {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Users must belong to this organization.")
		return false
	}
	ob, err := organization.OrgIDForUser(ctx, d.Pool, userB)
	if err != nil || ob != orgID {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Users must belong to this organization.")
		return false
	}
	return true
}

// handleOrgParentLinksCollection is GET/POST /api/v1/orgs/{orgId}/parent-links
func (d Deps) handleOrgParentLinksCollection() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		orgID, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "orgId")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		switch r.Method {
		case http.MethodGet:
			if _, ok := d.orgRoleAccess(w, r, orgID, true); !ok {
				return
			}
			list, err := parentlinks.ListByOrg(r.Context(), d.Pool, orgID, 200)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to list parent links.")
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{"links": list})
		case http.MethodPost:
			actor, ok := d.orgRoleAccess(w, r, orgID, true)
			if !ok {
				return
			}
			var body struct {
				ParentUserID       string  `json:"parentUserId"`
				StudentUserID      string  `json:"studentUserId"`
				Relationship       *string `json:"relationship"`
				ParentUserIDSnake  string  `json:"parent_user_id"`
				StudentUserIDSnake string  `json:"student_user_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
				return
			}
			pStr := strings.TrimSpace(body.ParentUserID)
			if pStr == "" {
				pStr = strings.TrimSpace(body.ParentUserIDSnake)
			}
			sStr := strings.TrimSpace(body.StudentUserID)
			if sStr == "" {
				sStr = strings.TrimSpace(body.StudentUserIDSnake)
			}
			parentID, err := uuid.Parse(pStr)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid parent user id.")
				return
			}
			studentID, err := uuid.Parse(sStr)
			if err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid student user id.")
				return
			}
			if parentID == studentID {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Parent and student must differ.")
				return
			}
			if !d.assertSameOrgUsers(r.Context(), w, orgID, parentID, studentID) {
				return
			}
			rel := "parent"
			if body.Relationship != nil && strings.TrimSpace(*body.Relationship) != "" {
				rel = strings.TrimSpace(*body.Relationship)
			}
			switch rel {
			case "parent", "guardian", "other":
			default:
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid relationship.")
				return
			}
			ln, err := parentlinks.UpsertActive(r.Context(), d.Pool, orgID, parentID, studentID, rel, &actor)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to create link.")
				return
			}
			_ = d.markUserAsParentAccount(r.Context(), parentID)
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(map[string]any{"link": ln})
		default:
			w.Header().Set("Allow", http.MethodGet+","+http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		}
	}
}

// handleOrgParentLinksBulk is POST /api/v1/orgs/{orgId}/parent-links/bulk
func (d Deps) handleOrgParentLinksBulk() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgID, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "orgId")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		actor, ok := d.orgRoleAccess(w, r, orgID, true)
		if !ok {
			return
		}
		ct := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
		var created int
		switch {
		case strings.HasPrefix(ct, "text/csv"):
			cr := csv.NewReader(r.Body)
			cr.TrimLeadingSpace = true
			for {
				rec, err := cr.Read()
				if err == io.EOF {
					break
				}
				if err != nil {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid CSV.")
					return
				}
				if len(rec) < 2 {
					continue
				}
				a, b := strings.TrimSpace(rec[0]), strings.TrimSpace(rec[1])
				if strings.EqualFold(a, "parent_email") && strings.EqualFold(b, "student_email") {
					continue
				}
				if a == "" || b == "" {
					continue
				}
				pu, err := user.FindByEmail(r.Context(), d.Pool, user.NormalizeEmail(a))
				if err != nil || pu == nil {
					continue
				}
				su, err := user.FindByEmail(r.Context(), d.Pool, user.NormalizeEmail(b))
				if err != nil || su == nil {
					continue
				}
				parentID, e1 := uuid.Parse(pu.ID)
				studentID, e2 := uuid.Parse(su.ID)
				if e1 != nil || e2 != nil || parentID == studentID {
					continue
				}
				if !d.assertSameOrgUsers(r.Context(), w, orgID, parentID, studentID) {
					return
				}
				if _, err := parentlinks.UpsertActive(r.Context(), d.Pool, orgID, parentID, studentID, "parent", &actor); err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to import row.")
					return
				}
				_ = d.markUserAsParentAccount(r.Context(), parentID)
				created++
			}
		default:
			var body struct {
				Rows []struct {
					ParentUserID  string `json:"parentUserId"`
					StudentUserID string `json:"studentUserId"`
					Relationship  string `json:"relationship"`
				} `json:"rows"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body (expected rows[]).")
				return
			}
			for _, row := range body.Rows {
				parentID, err := uuid.Parse(strings.TrimSpace(row.ParentUserID))
				if err != nil {
					continue
				}
				studentID, err := uuid.Parse(strings.TrimSpace(row.StudentUserID))
				if err != nil {
					continue
				}
				if parentID == studentID {
					continue
				}
				if !d.assertSameOrgUsers(r.Context(), w, orgID, parentID, studentID) {
					return
				}
				rel := strings.TrimSpace(row.Relationship)
				if rel == "" {
					rel = "parent"
				}
				if _, err := parentlinks.UpsertActive(r.Context(), d.Pool, orgID, parentID, studentID, rel, &actor); err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to import row.")
					return
				}
				_ = d.markUserAsParentAccount(r.Context(), parentID)
				created++
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"created": created})
	}
}

// handleOrgParentLinkDelete is DELETE /api/v1/orgs/{orgId}/parent-links/{lid}
func (d Deps) handleOrgParentLinkDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		orgID, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "orgId")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid organization id.")
			return
		}
		if _, ok := d.orgRoleAccess(w, r, orgID, true); !ok {
			return
		}
		lid, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "lid")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid link id.")
			return
		}
		ok, err := parentlinks.Revoke(r.Context(), d.Pool, orgID, lid)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to revoke link.")
			return
		}
		if !ok {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Link not found.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
