package rbac

import (
	"context"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/authz"
	"github.com/lextures/lextures/server/internal/repos/coursegrants"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
)

// ListGrantedPermissionStrings returns distinct role + per-course grant strings, with catalog expansion.
func ListGrantedPermissionStrings(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]string, error) {
	return listGrantedPermissionStringsInner(ctx, pool, userID, nil)
}

// ListGrantedPermissionStringsCourseView applies student “view as” filtering for a course.
func ListGrantedPermissionStringsCourseView(
	ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, courseCode string, viewAsStudent bool,
) ([]string, error) {
	return listGrantedPermissionStringsInner(ctx, pool, userID, &courseViewFilter{
		courseCode:     courseCode,
		viewAsStudent: viewAsStudent,
	})
}

type courseViewFilter struct {
	courseCode     string
	viewAsStudent bool
}

func listGrantedPermissionStringsInner(
	ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, courseView *courseViewFilter,
) ([]string, error) {
	rows, err := pool.Query(ctx, `
SELECT s.permission_string FROM (
	SELECT DISTINCT p.permission_string
	FROM "user".user_app_roles uar
	INNER JOIN "user".rbac_role_permissions rp ON rp.role_id = uar.role_id
	INNER JOIN "user".permissions p ON p.id = rp.permission_id
	WHERE uar.user_id = $1
	UNION
	SELECT DISTINCT g.permission_string
	FROM course.user_course_grants g
	WHERE g.user_id = $1
) AS s
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var raw []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		raw = append(raw, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	staffCodes, err := enrollment.ListCourseCodesWhereUserIsStaff(ctx, pool, userID)
	if err != nil {
		return nil, err
	}
	if courseView != nil && courseView.viewAsStudent {
		var filtered []string
		for _, c := range staffCodes {
			if c != courseView.courseCode {
				filtered = append(filtered, c)
			}
		}
		staffCodes = filtered
	}

	out := make(map[string]struct{})
	for _, s := range raw {
		if coursegrants.IsCoursePermissionWithPlaceholderToken(s) {
			for _, cc := range staffCodes {
				if concrete, ok := coursegrants.ExpandCoursePermissionForCourse(s, cc); ok {
					out[concrete] = struct{}{}
				}
			}
		} else {
			out[s] = struct{}{}
		}
	}
	coursegrants.AddItemsCreateSiblingGrants(out)

	if courseView == nil || !courseView.viewAsStudent {
		return setToSortedSlice(out), nil
	}
	teacher, err := listPermissionStringsForRoleName(ctx, pool, "Teacher")
	if err != nil {
		return nil, err
	}
	student, err := listPermissionStringsForRoleName(ctx, pool, "Student")
	if err != nil {
		return nil, err
	}
	filtered := filterGrantsForStudentCourseView(courseView.courseCode, out, teacher, student)
	return setToSortedSlice(filtered), nil
}

func setToSortedSlice(m map[string]struct{}) []string {
	if len(m) == 0 {
		return nil
	}
	s := make([]string, 0, len(m))
	for k := range m {
		s = append(s, k)
	}
	sort.Strings(s)
	return s
}

func listPermissionStringsForRoleName(ctx context.Context, pool *pgxpool.Pool, roleName string) ([]string, error) {
	rows, err := pool.Query(ctx, `
SELECT p.permission_string
FROM "user".app_roles r
INNER JOIN "user".rbac_role_permissions rp ON rp.role_id = r.id
INNER JOIN "user".permissions p ON p.id = rp.permission_id
WHERE r.name = $1
ORDER BY p.permission_string ASC
`, roleName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func courseItemPairMatchesCatalog(catalog []string, p string) bool {
	if authz.AnyGrantMatch(catalog, p) {
		return true
	}
	if prefix, ok := strings.CutSuffix(p, ":items:create"); ok && strings.HasPrefix(prefix, "course:") {
		alt := prefix + ":item:create"
		if authz.AnyGrantMatch(catalog, alt) {
			return true
		}
	}
	if prefix, ok := strings.CutSuffix(p, ":item:create"); ok && strings.HasPrefix(prefix, "course:") {
		alt := prefix + ":items:create"
		if authz.AnyGrantMatch(catalog, alt) {
			return true
		}
	}
	return false
}

func courseRoleCatalogMatchesConcrete(catalog []string, p, courseCode string) bool {
	if courseItemPairMatchesCatalog(catalog, p) {
		return true
	}
	for _, entry := range catalog {
		if exp, ok := coursegrants.ExpandCoursePermissionForCourse(entry, courseCode); ok {
			if authz.PermissionMatches(exp, p) {
				return true
			}
		}
	}
	return false
}

func filterGrantsForStudentCourseView(
	courseCode string, grants map[string]struct{}, teacherCatalog, studentCatalog []string,
) map[string]struct{} {
	out := make(map[string]struct{})
	for p := range grants {
		parts := strings.Split(strings.TrimSpace(p), ":")
		if len(parts) == 4 && parts[0] == "course" {
			if parts[1] == courseCode {
				teacherMatch := courseRoleCatalogMatchesConcrete(teacherCatalog, p, courseCode)
				studentMatch := courseRoleCatalogMatchesConcrete(studentCatalog, p, courseCode)
				if !teacherMatch || studentMatch {
					out[p] = struct{}{}
				}
			} else {
				// different course
				out[p] = struct{}{}
			}
		} else {
			if authz.AnyGrantMatch(studentCatalog, p) {
				out[p] = struct{}{}
			}
		}
	}
	return out
}
