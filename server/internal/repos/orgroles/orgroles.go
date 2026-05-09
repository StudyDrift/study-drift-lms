// Package orgroles manages org-scoped role grants (plan 5.8).
package orgroles

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Role string

const (
	RoleOrgAdmin     Role = "org_admin"
	RoleOrgUnitAdmin Role = "org_unit_admin"
	RoleOrgViewer    Role = "org_viewer"
)

type Grant struct {
	ID        uuid.UUID
	OrgID     uuid.UUID
	UserID    uuid.UUID
	OrgUnitID *uuid.UUID
	Role      Role
	GrantedBy *uuid.UUID
	GrantedAt time.Time
	ExpiresAt *time.Time
}

func ListByOrg(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID) ([]Grant, error) {
	rows, err := pool.Query(ctx, `
SELECT id, org_id, user_id, org_unit_id, role, granted_by, granted_at, expires_at
FROM "user".org_role_grants
WHERE org_id = $1
ORDER BY granted_at DESC
`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Grant
	for rows.Next() {
		var g Grant
		var role string
		if err := rows.Scan(&g.ID, &g.OrgID, &g.UserID, &g.OrgUnitID, &role, &g.GrantedBy, &g.GrantedAt, &g.ExpiresAt); err != nil {
			return nil, err
		}
		g.Role = Role(role)
		out = append(out, g)
	}
	return out, rows.Err()
}

func Create(ctx context.Context, pool *pgxpool.Pool, orgID, userID uuid.UUID, orgUnitID *uuid.UUID, role Role, grantedBy *uuid.UUID, expiresAt *time.Time) (*Grant, error) {
	var g Grant
	var roleStr string
	err := pool.QueryRow(ctx, `
INSERT INTO "user".org_role_grants (org_id, user_id, org_unit_id, role, granted_by, expires_at)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (org_id, user_id, role, org_unit_id) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  granted_at = NOW(),
  expires_at = EXCLUDED.expires_at
RETURNING id, org_id, user_id, org_unit_id, role, granted_by, granted_at, expires_at
`, orgID, userID, orgUnitID, string(role), grantedBy, expiresAt).Scan(
		&g.ID, &g.OrgID, &g.UserID, &g.OrgUnitID, &roleStr, &g.GrantedBy, &g.GrantedAt, &g.ExpiresAt,
	)
	if err != nil {
		return nil, err
	}
	g.Role = Role(roleStr)
	return &g, nil
}

func DeleteByID(ctx context.Context, pool *pgxpool.Pool, orgID, grantID uuid.UUID) (*Grant, error) {
	var g Grant
	var roleStr string
	err := pool.QueryRow(ctx, `
DELETE FROM "user".org_role_grants
WHERE id = $1 AND org_id = $2
RETURNING id, org_id, user_id, org_unit_id, role, granted_by, granted_at, expires_at
`, grantID, orgID).Scan(
		&g.ID, &g.OrgID, &g.UserID, &g.OrgUnitID, &roleStr, &g.GrantedBy, &g.GrantedAt, &g.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	g.Role = Role(roleStr)
	return &g, nil
}

// UserHasRole returns true if user has an unexpired grant for role in org (and optional unit).
func UserHasRole(ctx context.Context, pool *pgxpool.Pool, userID, orgID uuid.UUID, role Role) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1
  FROM "user".org_role_grants
  WHERE user_id = $1
    AND org_id = $2
    AND role = $3
    AND (expires_at IS NULL OR expires_at > NOW())
)
`, userID, orgID, string(role)).Scan(&ok)
	return ok, err
}

// SweepExpired deletes up to limit expired grants. Returns number deleted.
func SweepExpired(ctx context.Context, pool *pgxpool.Pool, now time.Time, limit int) (int64, error) {
	if limit <= 0 {
		limit = 200
	}
	tag, err := pool.Exec(ctx, `
WITH doomed AS (
  SELECT id
  FROM "user".org_role_grants
  WHERE expires_at IS NOT NULL AND expires_at <= $1
  ORDER BY expires_at ASC
  LIMIT $2
)
DELETE FROM "user".org_role_grants g
USING doomed d
WHERE g.id = d.id
`, now, limit)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

