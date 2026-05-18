package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/courseroles"
	modelenrollment "github.com/lextures/lextures/server/internal/models/enrollment"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/orgroles"
)

func parseEnrollmentEmails(raw string) []string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	for _, sep := range []string{",", "\n", ";"} {
		s = strings.ReplaceAll(s, sep, " ")
	}
	var parts []string
	for _, tok := range strings.Fields(s) {
		t := strings.TrimSpace(tok)
		if t != "" {
			parts = append(parts, t)
		}
	}
	return parts
}

func normalizeCourseEnrollmentRole(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// enrollmentRoleCapabilities holds catalog capability bits for a role.
type enrollmentRoleCapabilities struct {
	Valid    bool
	IsStaff  bool
}

// lookupEnrollmentRoleCapabilities queries course.enrollment_roles for capability bits.
// Returns {Valid: false} when the role_key does not exist in the catalog.
func lookupEnrollmentRoleCapabilities(ctx context.Context, pool *pgxpool.Pool, role string) (enrollmentRoleCapabilities, error) {
	var caps enrollmentRoleCapabilities
	err := pool.QueryRow(ctx, `
SELECT true, is_staff
FROM course.enrollment_roles
WHERE role_key = $1
`, role).Scan(&caps.Valid, &caps.IsStaff)
	if err != nil {
		if err == pgx.ErrNoRows {
			return enrollmentRoleCapabilities{Valid: false}, nil
		}
		return enrollmentRoleCapabilities{}, err
	}
	return caps, nil
}

func chiCourseCode(w http.ResponseWriter, r *http.Request) (string, bool) {
	courseCode := strings.TrimSpace(chi.URLParam(r, "course_code"))
	if courseCode == "" {
		apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing course code.")
		return "", false
	}
	return courseCode, true
}

func (d Deps) handleCourseEnrollmentsPost() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		courseCode, ok := chiCourseCode(w, r)
		if !ok {
			return
		}
		can, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":enrollments:update")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to manage enrollments.")
			return
		}
		var body modelenrollment.AddEnrollmentsRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		emails := parseEnrollmentEmails(body.Emails)
		if len(emails) == 0 {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Provide at least one email address.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		var orgID uuid.UUID
		if err := d.Pool.QueryRow(r.Context(), `SELECT org_id FROM course.courses WHERE id = $1`, *cid).Scan(&orgID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
			return
		}
		ctx := r.Context()
		var added, already, notFound []string
		tx, err := d.Pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to start transaction.")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()

		if body.CourseRole != nil && strings.TrimSpace(*body.CourseRole) != "" {
			role := normalizeCourseEnrollmentRole(*body.CourseRole)
			roleCaps, err := lookupEnrollmentRoleCapabilities(ctx, d.Pool, role)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify role.")
				return
			}
			if !roleCaps.Valid {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid courseRole.")
				return
			}
			if roleCaps.IsStaff {
				staff, err := enrollment.UserIsCourseStaff(ctx, d.Pool, courseCode, viewer)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
					return
				}
				orgAdmin, err := orgroles.UserHasRole(ctx, d.Pool, viewer, orgID, orgroles.RoleOrgAdmin)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
					return
				}
				if !staff && !orgAdmin {
					apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only course instructors can assign this role.")
					return
				}
			}
			for _, em := range emails {
				var uid uuid.UUID
				err := tx.QueryRow(ctx, `
SELECT u.id
FROM "user".users u
WHERE u.org_id = $1 AND lower(trim(u.email)) = lower(trim($2))
LIMIT 1
`, orgID, em).Scan(&uid)
				if err != nil {
					if err == pgx.ErrNoRows {
						notFound = append(notFound, em)
						continue
					}
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to look up user.")
					return
				}
				tag, err := tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role)
VALUES ($1, $2, $3)
ON CONFLICT (course_id, user_id, role) DO NOTHING
`, *cid, uid, role)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to add enrollment.")
					return
				}
				if tag.RowsAffected() == 0 {
					already = append(already, em)
				} else {
					added = append(added, em)
				}
				if err := courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, uid, *cid, courseCode); err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to sync course permissions.")
					return
				}
			}
		} else if body.AppRoleID != nil {
			var scope string
			err := tx.QueryRow(ctx, `SELECT scope FROM "user".app_roles WHERE id = $1`, *body.AppRoleID).Scan(&scope)
			if err == pgx.ErrNoRows {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Unknown app role.")
				return
			}
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load app role.")
				return
			}
			if scope != "course" {
				apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "appRoleId must reference a course-scoped role.")
				return
			}
			for _, em := range emails {
				var uid uuid.UUID
				err := tx.QueryRow(ctx, `
SELECT u.id
FROM "user".users u
WHERE u.org_id = $1 AND lower(trim(u.email)) = lower(trim($2))
LIMIT 1
`, orgID, em).Scan(&uid)
				if err != nil {
					if err == pgx.ErrNoRows {
						notFound = append(notFound, em)
						continue
					}
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to look up user.")
					return
				}
				tag, err := tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role)
VALUES ($1, $2, 'student')
ON CONFLICT (course_id, user_id, role) DO NOTHING
`, *cid, uid)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to add enrollment.")
					return
				}
				if tag.RowsAffected() == 0 {
					already = append(already, em)
				} else {
					added = append(added, em)
				}
				if _, err := tx.Exec(ctx, `
INSERT INTO "user".user_app_roles (user_id, role_id)
VALUES ($1, $2)
ON CONFLICT (user_id, role_id) DO NOTHING
`, uid, *body.AppRoleID); err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to link app role.")
					return
				}
				if err := courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, uid, *cid, courseCode); err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to sync course permissions.")
					return
				}
			}
		} else {
			for _, em := range emails {
				var uid uuid.UUID
				err := tx.QueryRow(ctx, `
SELECT u.id
FROM "user".users u
WHERE u.org_id = $1 AND lower(trim(u.email)) = lower(trim($2))
LIMIT 1
`, orgID, em).Scan(&uid)
				if err != nil {
					if err == pgx.ErrNoRows {
						notFound = append(notFound, em)
						continue
					}
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to look up user.")
					return
				}
				tag, err := tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role)
VALUES ($1, $2, 'student')
ON CONFLICT (course_id, user_id, role) DO NOTHING
`, *cid, uid)
				if err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to add enrollment.")
					return
				}
				if tag.RowsAffected() == 0 {
					already = append(already, em)
				} else {
					added = append(added, em)
				}
				if err := courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, uid, *cid, courseCode); err != nil {
					apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to sync course permissions.")
					return
				}
			}
		}
		if err := tx.Commit(ctx); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save enrollments.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(modelenrollment.AddEnrollmentsResponse{
			Added:           added,
			AlreadyEnrolled: already,
			NotFound:        notFound,
		})
	}
}

func (d Deps) handleCourseEnrollmentsSelfStudent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		courseCode, ok := chiCourseCode(w, r)
		if !ok {
			return
		}
		hasTeacher, err := enrollment.UserHasEnrollmentRole(r.Context(), d.Pool, courseCode, viewer, "teacher")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify enrollment.")
			return
		}
		if !hasTeacher {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only the course creator may use this action.")
			return
		}
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Course not found.")
			return
		}
		ctx := r.Context()
		tx, err := d.Pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to start transaction.")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		tag, err := tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role)
VALUES ($1, $2, 'student')
ON CONFLICT (course_id, user_id, role) DO NOTHING
`, *cid, viewer)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to enroll.")
			return
		}
		if err := courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, viewer, *cid, courseCode); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to sync course permissions.")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save enrollment.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(modelenrollment.EnrollSelfAsStudentResponse{Created: tag.RowsAffected() > 0})
	}
}

func (d Deps) handleCourseEnrollmentsPatch() http.HandlerFunc {
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
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		courseCode, ok := chiCourseCode(w, r)
		if !ok {
			return
		}
		can, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":enrollments:update")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to manage enrollments.")
			return
		}
		eid, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "enrollment_id")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid enrollment id.")
			return
		}
		var body modelenrollment.PatchEnrollmentRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		var newRole string
		switch {
		case body.CourseRole != nil && strings.TrimSpace(*body.CourseRole) != "":
			newRole = normalizeCourseEnrollmentRole(*body.CourseRole)
		case body.Role != nil && strings.EqualFold(strings.TrimSpace(*body.Role), "student"):
			newRole = "student"
		default:
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Provide courseRole or role=student.")
			return
		}
		roleCaps, err := lookupEnrollmentRoleCapabilities(r.Context(), d.Pool, newRole)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify role.")
			return
		}
		if !roleCaps.Valid {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid course role.")
			return
		}
		if roleCaps.IsStaff {
			staff, err := enrollment.UserIsCourseStaff(r.Context(), d.Pool, courseCode, viewer)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
				return
			}
			var orgID uuid.UUID
			if err := d.Pool.QueryRow(r.Context(), `
SELECT c.org_id FROM course.courses c WHERE c.course_code = $1
`, courseCode).Scan(&orgID); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load course.")
				return
			}
			orgAdmin, err := orgroles.UserHasRole(r.Context(), d.Pool, viewer, orgID, orgroles.RoleOrgAdmin)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify access.")
				return
			}
			if !staff && !orgAdmin {
				apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Only course instructors can assign this role.")
				return
			}
		}
		ctx := r.Context()
		tx, err := d.Pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to start transaction.")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		var uid uuid.UUID
		var courseID uuid.UUID
		err = tx.QueryRow(ctx, `
SELECT ce.user_id, ce.course_id
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE ce.id = $1 AND c.course_code = $2 AND ce.active
`, eid, courseCode).Scan(&uid, &courseID)
		if err == pgx.ErrNoRows {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Enrollment not found.")
			return
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollment.")
			return
		}
		if _, err := tx.Exec(ctx, `UPDATE course.course_enrollments SET role = $1 WHERE id = $2`, newRole, eid); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update enrollment.")
			return
		}
		if err := courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, uid, courseID, courseCode); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to sync course permissions.")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save enrollment.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (d Deps) handleCourseEnrollmentsDelete() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete+","+http.MethodOptions)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		viewer, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		courseCode, ok := chiCourseCode(w, r)
		if !ok {
			return
		}
		can, err := courseroles.UserHasPermission(r.Context(), d.Pool, viewer, "course:"+courseCode+":enrollments:update")
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to verify permissions.")
			return
		}
		if !can {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission to manage enrollments.")
			return
		}
		eid, err := uuid.Parse(strings.TrimSpace(chi.URLParam(r, "enrollment_id")))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid enrollment id.")
			return
		}
		ctx := r.Context()
		tx, err := d.Pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to start transaction.")
			return
		}
		defer func() { _ = tx.Rollback(ctx) }()
		var uid uuid.UUID
		var courseID uuid.UUID
		err = tx.QueryRow(ctx, `
SELECT ce.user_id, ce.course_id
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE ce.id = $1 AND c.course_code = $2 AND ce.active
`, eid, courseCode).Scan(&uid, &courseID)
		if err == pgx.ErrNoRows {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Enrollment not found.")
			return
		}
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load enrollment.")
			return
		}
		if _, err := tx.Exec(ctx, `DELETE FROM course.course_enrollments WHERE id = $1`, eid); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to remove enrollment.")
			return
		}
		if err := courseroles.RefreshManagedGrantsForCourseUser(ctx, tx, uid, courseID, courseCode); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to sync course permissions.")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to save.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
