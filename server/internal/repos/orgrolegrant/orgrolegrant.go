// Package orgrolegrant stores and queries tenant.org_role_grants (plan 5.8 org role hierarchy).
package orgrolegrant

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Org-scoped role names stored in tenant.org_role_grants.role.
const (
	RoleOrgAdmin     = "org_admin"
	RoleOrgUnitAdmin = "org_unit_admin"
	RoleOrgViewer    = "org_viewer"
)

// Row is one grant row for APIs.
type Row struct {
	ID        uuid.UUID
	OrgID     uuid.UUID
	UserID    uuid.UUID
	OrgUnitID *uuid.UUID
	Role      string
	GrantedBy uuid.UUID
	GrantedAt time.Time
	ExpiresAt *time.Time
}

const activeGrantSQL = `(g.expires_at IS NULL OR g.expires_at > NOW())`

// DeleteExpired removes expired grants (idempotent). Returns rows deleted.
func DeleteExpired(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	tag, err := pool.Exec(ctx, `
DELETE FROM tenant.org_role_grants
WHERE expires_at IS NOT NULL AND expires_at <= NOW()
`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// HasActiveOrgAdmin is true when the user holds an active org_admin grant for orgID (org-wide).
func HasActiveOrgAdmin(ctx context.Context, pool *pgxpool.Pool, userID, orgID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM tenant.org_role_grants g
  WHERE g.org_id = $1 AND g.user_id = $2 AND g.role = $3 AND g.org_unit_id IS NULL AND `+activeGrantSQL+`
)
`, orgID, userID, RoleOrgAdmin).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// CanManageOrgRoleGrants is true for global platform check OR active org_admin grant on orgID.
func CanManageOrgRoleGrants(ctx context.Context, pool *pgxpool.Pool, userID, orgID uuid.UUID, isGlobalAdmin bool) (bool, error) {
	if isGlobalAdmin {
		return true, nil
	}
	return HasActiveOrgAdmin(ctx, pool, userID, orgID)
}

// OrgCourseAccess describes how org catalog courses may be listed for a user.
type OrgCourseAccess int

const (
	OrgCourseAccessNone OrgCourseAccess = iota
	OrgCourseAccessAllInOrg
	OrgCourseAccessSubtree
)

// ResolveOrgCourseAccess returns how much of orgID's course catalog userID may see via org grants (not enrollments).
func ResolveOrgCourseAccess(ctx context.Context, pool *pgxpool.Pool, userID, orgID uuid.UUID, isGlobalAdmin bool) (OrgCourseAccess, error) {
	if isGlobalAdmin {
		return OrgCourseAccessAllInOrg, nil
	}
	var adminOrViewer bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM tenant.org_role_grants g
  WHERE g.org_id = $1 AND g.user_id = $2
    AND g.role IN ($3, $4)
    AND g.org_unit_id IS NULL
    AND `+activeGrantSQL+`
)
`, orgID, userID, RoleOrgAdmin, RoleOrgViewer).Scan(&adminOrViewer)
	if err != nil {
		return OrgCourseAccessNone, err
	}
	if adminOrViewer {
		return OrgCourseAccessAllInOrg, nil
	}
	var unitScoped bool
	err = pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM tenant.org_role_grants g
  WHERE g.org_id = $1 AND g.user_id = $2 AND g.role = $3 AND g.org_unit_id IS NOT NULL AND `+activeGrantSQL+`
)
`, orgID, userID, RoleOrgUnitAdmin).Scan(&unitScoped)
	if err != nil {
		return OrgCourseAccessNone, err
	}
	if unitScoped {
		return OrgCourseAccessSubtree, nil
	}
	return OrgCourseAccessNone, nil
}

// ListOrgUnitAdminRootUnitIDs returns org_unit_id roots from org_role_grants for org_unit_admin in this org.
func ListOrgUnitAdminRootUnitIDs(ctx context.Context, pool *pgxpool.Pool, userID, orgID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := pool.Query(ctx, `
SELECT DISTINCT g.org_unit_id
FROM tenant.org_role_grants g
WHERE g.org_id = $1 AND g.user_id = $2 AND g.role = $3
  AND g.org_unit_id IS NOT NULL
  AND `+activeGrantSQL+`
`, orgID, userID, RoleOrgUnitAdmin)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ListByOrg returns active grants for an organization.
func ListByOrg(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID) ([]Row, error) {
	rows, err := pool.Query(ctx, `
SELECT g.id, g.org_id, g.user_id, g.org_unit_id, g.role, g.granted_by, g.granted_at, g.expires_at
FROM tenant.org_role_grants g
WHERE g.org_id = $1 AND `+activeGrantSQL+`
ORDER BY g.role ASC, g.granted_at DESC
`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}

func scanRows(rows pgx.Rows) ([]Row, error) {
	var out []Row
	for rows.Next() {
		var r Row
		var unit *uuid.UUID
		var exp *time.Time
		if err := rows.Scan(&r.ID, &r.OrgID, &r.UserID, &unit, &r.Role, &r.GrantedBy, &r.GrantedAt, &exp); err != nil {
			return nil, err
		}
		r.OrgUnitID = unit
		r.ExpiresAt = exp
		out = append(out, r)
	}
	return out, rows.Err()
}

// Insert creates a grant after validating shape and target membership.
func Insert(
	ctx context.Context, pool *pgxpool.Pool,
	orgID, targetUserID uuid.UUID,
	role string,
	grantedBy uuid.UUID,
	orgUnitID *uuid.UUID,
	expiresAt *time.Time,
) (*Row, error) {
	role = strings.TrimSpace(role)
	switch role {
	case RoleOrgAdmin, RoleOrgViewer:
		if orgUnitID != nil {
			return nil, fmt.Errorf("org_unit_id must be omitted for role %s", role)
		}
	case RoleOrgUnitAdmin:
		if orgUnitID == nil {
			return nil, errors.New("org_unit_id is required for org_unit_admin")
		}
	default:
		return nil, errors.New("invalid role")
	}
	var targetOrg uuid.UUID
	err := pool.QueryRow(ctx, `SELECT org_id FROM "user".users WHERE id = $1`, targetUserID).Scan(&targetOrg)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("user not found")
	}
	if err != nil {
		return nil, err
	}
	if targetOrg != orgID {
		return nil, errors.New("user must belong to the organization")
	}
	if orgUnitID != nil {
		var uOrg uuid.UUID
		err = pool.QueryRow(ctx, `SELECT org_id FROM tenant.org_units WHERE id = $1`, *orgUnitID).Scan(&uOrg)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("org unit not found")
		}
		if err != nil {
			return nil, err
		}
		if uOrg != orgID {
			return nil, errors.New("org unit does not belong to this organization")
		}
	}
	var r Row
	var unitOut *uuid.UUID
	var expOut *time.Time
	err = pool.QueryRow(ctx, `
INSERT INTO tenant.org_role_grants (org_id, user_id, org_unit_id, role, granted_by, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, org_id, user_id, org_unit_id, role, granted_by, granted_at, expires_at
`, orgID, targetUserID, orgUnitID, role, grantedBy, expiresAt).Scan(
		&r.ID, &r.OrgID, &r.UserID, &unitOut, &r.Role, &r.GrantedBy, &r.GrantedAt, &expOut,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, errors.New("duplicate grant: this user already has this role for the org or unit")
		}
		return nil, err
	}
	r.OrgUnitID = unitOut
	r.ExpiresAt = expOut
	return &r, nil
}

// DeleteByID removes a grant in orgID; returns false if not found.
func DeleteByID(ctx context.Context, pool *pgxpool.Pool, orgID, grantID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM tenant.org_role_grants WHERE id = $1 AND org_id = $2`, grantID, orgID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
