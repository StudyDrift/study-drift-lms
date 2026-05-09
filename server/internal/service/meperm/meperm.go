// Package meperm implements /api/v1/me/permissions resolution (server/src/routes/me.rs).
package meperm

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	"github.com/lextures/lextures/server/internal/repos/organization"
	"github.com/lextures/lextures/server/internal/repos/orgroles"
	"github.com/lextures/lextures/server/internal/repos/rbac"
)

// ErrNotFound is returned for 404 (e.g. view as student for a course the user does not access).
var ErrNotFound = errors.New("not found")

// InvalidInput is a request validation error (400, INVALID_INPUT).
type InvalidInput struct {
	Message string
}

func (e *InvalidInput) Error() string { return e.Message }

// MyPermissions returns permissionStrings for the authenticated user.
func MyPermissions(
	ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, courseCode, viewAs string,
) ([]string, error) {
	courseCode = strings.TrimSpace(courseCode)
	if courseCode == "" {
		if strings.TrimSpace(viewAs) != "" {
			return nil, &InvalidInput{Message: "courseCode is required when viewAs is set."}
		}
		base, err := rbac.ListGrantedPermissionStrings(ctx, pool, userID)
		if err != nil {
			return nil, err
		}
		return withOrgRolePermissions(ctx, pool, userID, base)
	}
	viewAsStudent, err := parseViewAs(viewAs)
	if err != nil {
		return nil, err
	}
	inCourse, err := enrollment.UserHasAccess(ctx, pool, courseCode, userID)
	if err != nil {
		return nil, err
	}
	if !inCourse {
		if viewAsStudent {
			return nil, ErrNotFound
		}
		base, err := rbac.ListGrantedPermissionStrings(ctx, pool, userID)
		if err != nil {
			return nil, err
		}
		return withOrgRolePermissions(ctx, pool, userID, base)
	}
	if viewAsStudent {
		stu, err := enrollment.UserHasEnrollmentRole(ctx, pool, courseCode, userID, "student")
		if err != nil {
			return nil, err
		}
		if !stu {
			return nil, &InvalidInput{Message: "Not enrolled as a student in this course."}
		}
		base, err := rbac.ListGrantedPermissionStringsCourseView(ctx, pool, userID, courseCode, true)
		if err != nil {
			return nil, err
		}
		return withOrgRolePermissions(ctx, pool, userID, base)
	}
	isStaff, err := enrollment.UserIsCourseStaff(ctx, pool, courseCode, userID)
	if err != nil {
		return nil, err
	}
	if isStaff {
		base, err := rbac.ListGrantedPermissionStrings(ctx, pool, userID)
		if err != nil {
			return nil, err
		}
		return withOrgRolePermissions(ctx, pool, userID, base)
	}
	base, err := rbac.ListGrantedPermissionStringsCourseView(ctx, pool, userID, courseCode, true)
	if err != nil {
		return nil, err
	}
	return withOrgRolePermissions(ctx, pool, userID, base)
}

const (
	permOrgRolesManage = "tenant:org:roles:manage"
	permOrgRolesView   = "tenant:org:roles:view"
)

func withOrgRolePermissions(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, base []string) ([]string, error) {
	orgID, err := organization.OrgIDForUser(ctx, pool, userID)
	if err != nil {
		return nil, err
	}
	isAdmin, err := orgroles.UserHasRole(ctx, pool, userID, orgID, orgroles.RoleOrgAdmin)
	if err != nil {
		return nil, err
	}
	isViewer, err := orgroles.UserHasRole(ctx, pool, userID, orgID, orgroles.RoleOrgViewer)
	if err != nil {
		return nil, err
	}
	if !isAdmin && !isViewer {
		return base, nil
	}
	out := append([]string{}, base...)
	if isViewer {
		out = append(out, permOrgRolesView)
	}
	if isAdmin {
		out = append(out, permOrgRolesManage)
		// org_admin implies org unit management for the org, even without unit-scoped grants.
		out = append(out, "tenant:org:units:admin")
	}
	return out, nil
}

func parseViewAs(s string) (isStudent bool, _ error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return false, nil
	}
	switch strings.ToLower(s) {
	case "teacher":
		return false, nil
	case "student":
		return true, nil
	default:
		return false, &InvalidInput{Message: `viewAs must be "teacher" or "student".`}
	}
}

// HTTPError maps meperm errors to (status, code, message) for apierr.
func HTTPErrorFor(err error) (status int, code, message string) {
	if err == nil {
		return 200, "", ""
	}
	if errors.Is(err, ErrNotFound) {
		return 404, apierr.CodeNotFound, "Resource not found."
	}
	var inv *InvalidInput
	if errors.As(err, &inv) {
		return 400, apierr.CodeInvalidInput, inv.Message
	}
	return 500, apierr.CodeInternal, fmt.Sprintf("internal error: %v", err)
}
