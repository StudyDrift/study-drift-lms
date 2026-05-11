// Package courseroles maps course.course_enrollments.role values to concrete course:* permissions
// (plan 5.9 — extended course roles).
package courseroles

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/repos/coursegrants"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

// ExtendedStaffRoles are non–primary-instructor staff roles managed by this package.
var ExtendedStaffRoles = []string{"ta", "designer", "observer", "auditor", "librarian"}

// IsExtendedStaffRole reports whether role is one of the extended staff roles.
func IsExtendedStaffRole(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "ta", "designer", "observer", "auditor", "librarian":
		return true
	default:
		return false
	}
}

func isPrimaryInstructorRole(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "teacher", "instructor", "owner":
		return true
	default:
		return false
	}
}

// ManagedPermissionSuffixes are course-level grants this package deletes before re-seeding.
func ManagedPermissionSuffixes() []string {
	return []string{
		"item:create",
		"items:create",
		"enrollments:read",
		"enrollments:update",
		"gradebook:view",
	}
}

// ConcreteManagedPermissions returns full permission strings for a course code.
func ConcreteManagedPermissions(courseCode string) []string {
	prefix := "course:" + courseCode + ":"
	sfx := ManagedPermissionSuffixes()
	out := make([]string, 0, len(sfx))
	for _, s := range sfx {
		out = append(out, prefix+s)
	}
	return out
}

// RoleMatrixPermissions returns per-course permission strings for an enrollment role (may be empty).
func RoleMatrixPermissions(courseCode, role string) []string {
	prefix := "course:" + courseCode + ":"
	r := strings.ToLower(strings.TrimSpace(role))
	switch r {
	case "teacher", "instructor", "owner":
		return []string{
			prefix + "item:create",
			prefix + "items:create",
			prefix + "enrollments:read",
			prefix + "enrollments:update",
			prefix + "gradebook:view",
		}
	case "ta":
		return []string{
			prefix + "enrollments:read",
			prefix + "gradebook:view",
		}
	case "designer":
		return []string{
			prefix + "item:create",
			prefix + "items:create",
		}
	case "auditor":
		return []string{
			prefix + "enrollments:read",
			prefix + "gradebook:view",
		}
	case "observer", "librarian", "student":
		return nil
	default:
		return nil
	}
}

// ReplaceManagedStaffGrants removes managed course grants for the user in the course, then inserts
// the matrix for role. Safe for tx or pool.
func ReplaceManagedStaffGrants(ctx context.Context, exec pgx.Tx, userID, courseID uuid.UUID, courseCode, role string) error {
	managed := ConcreteManagedPermissions(courseCode)
	_, err := exec.Exec(ctx, `
DELETE FROM course.user_course_grants
 WHERE user_id = $1 AND course_id = $2 AND permission_string = ANY($3::text[])
`, userID, courseID, managed)
	if err != nil {
		return err
	}
	for _, perm := range RoleMatrixPermissions(courseCode, role) {
		if _, err := exec.Exec(ctx, `
INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING
`, userID, courseID, perm); err != nil {
			return err
		}
	}
	return nil
}

// RefreshManagedGrantsForCourseUser rebuilds managed grants from all active enrollment roles for the user.
func RefreshManagedGrantsForCourseUser(ctx context.Context, exec pgx.Tx, userID, courseID uuid.UUID, courseCode string) error {
	rows, err := exec.Query(ctx, `
SELECT DISTINCT ce.role
FROM course.course_enrollments ce
WHERE ce.course_id = $1 AND ce.user_id = $2 AND ce.active
`, courseID, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	var roles []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			return err
		}
		roles = append(roles, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	managed := ConcreteManagedPermissions(courseCode)
	if _, err := exec.Exec(ctx, `
DELETE FROM course.user_course_grants
 WHERE user_id = $1 AND course_id = $2 AND permission_string = ANY($3::text[])
`, userID, courseID, managed); err != nil {
		return err
	}
	seen := make(map[string]struct{})
	for _, role := range roles {
		for _, perm := range RoleMatrixPermissions(courseCode, role) {
			if _, ok := seen[perm]; ok {
				continue
			}
			seen[perm] = struct{}{}
			if _, err := exec.Exec(ctx, `
INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING
`, userID, courseID, perm); err != nil {
				return err
			}
		}
	}
	return nil
}

// ParseConcreteCoursePermission returns the course code when required is course:{code}:fn:act.
func ParseConcreteCoursePermission(required string) (courseCode string, ok bool) {
	parts := strings.Split(strings.TrimSpace(required), ":")
	if len(parts) != 4 || parts[0] != "course" {
		return "", false
	}
	if parts[1] == "" || parts[1] == "*" || parts[1] == coursegrants.CourseCodePlaceholder {
		return "", false
	}
	return parts[1], true
}

// UserHasPermission mirrors rbac.UserHasPermission but caps course-scoped checks when the viewer has
// only extended-staff enrollments (no teacher/instructor row) in that course.
func UserHasPermission(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, required string) (bool, error) {
	cc, isConcrete := ParseConcreteCoursePermission(required)
	if !isConcrete {
		return rbac.UserHasPermission(ctx, pool, userID, required)
	}
	roles, err := enrollment.UserRolesInCourse(ctx, pool, cc, userID)
	if err != nil {
		return false, err
	}
	hasPrimary := false
	var extended []string
	for _, r := range roles {
		if isPrimaryInstructorRole(r) {
			hasPrimary = true
		}
		if IsExtendedStaffRole(r) {
			extended = append(extended, r)
		}
	}
	if hasPrimary || len(extended) == 0 {
		return rbac.UserHasPermission(ctx, pool, userID, required)
	}
	allowed := map[string]struct{}{}
	for _, er := range extended {
		for _, p := range RoleMatrixPermissions(cc, er) {
			allowed[p] = struct{}{}
		}
	}
	if _, ok := allowed[required]; ok {
		return true, nil
	}
	return false, nil
}
