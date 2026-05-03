package authservice

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// orgJWTFieldsForUser returns org id and slug from the user's tenant row plus organization status.
func orgJWTFieldsForUser(ctx context.Context, pool *pgxpool.Pool, userID string) (orgID, orgSlug, status string, err error) {
	uid, err := uuid.Parse(userID)
	if err != nil {
		return "", "", "", err
	}
	var id uuid.UUID
	var slug string
	var st string
	e := pool.QueryRow(ctx, `
SELECT u.org_id, o.slug, o.status
FROM "user".users u
INNER JOIN tenant.organizations o ON o.id = u.org_id
WHERE u.id = $1
`, uid).Scan(&id, &slug, &st)
	if errors.Is(e, pgx.ErrNoRows) {
		return "", "", "", e
	}
	if e != nil {
		return "", "", "", e
	}
	return id.String(), slug, st, nil
}

// orgStatusForUser returns organization status for the user (empty if row missing).
func orgStatusForUser(ctx context.Context, pool *pgxpool.Pool, userID string) (string, error) {
	uid, err := uuid.Parse(userID)
	if err != nil {
		return "", err
	}
	var st string
	err = pool.QueryRow(ctx, `
SELECT o.status
FROM "user".users u
INNER JOIN tenant.organizations o ON o.id = u.org_id
WHERE u.id = $1
`, uid).Scan(&st)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return st, err
}

// orgAuthGate returns ErrOrgSuspended, ErrInvalidCredentials (deleted org), or nil.
func orgAuthGate(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	st, err := orgStatusForUser(ctx, pool, userID)
	if err != nil {
		return err
	}
	if st == "suspended" {
		return ErrOrgSuspended
	}
	if st == "deleted" || st == "" {
		return ErrInvalidCredentials
	}
	return nil
}
