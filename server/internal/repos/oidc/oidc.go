// Package oidc maps server/src/repos/oidc.rs (subset: linked identities for /me).
package oidc

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Identity is a row in settings.user_oidc_identities.
type Identity struct {
	ID       uuid.UUID
	Provider string
	Email    *string
}

func strOrNil(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := ns.String
	return &s
}

// ListByUserID returns external OIDC links for a user, ordered by provider.
func ListByUserID(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]Identity, error) {
	const q = `SELECT id, provider, email
FROM settings.user_oidc_identities
WHERE user_id = $1
ORDER BY provider`
	rows, err := pool.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Identity
	for rows.Next() {
		var id uuid.UUID
		var provider string
		var em sql.NullString
		if err := rows.Scan(&id, &provider, &em); err != nil {
			return nil, err
		}
		out = append(out, Identity{ID: id, Provider: provider, Email: strOrNil(em)})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		return []Identity{}, nil
	}
	return out, nil
}

// DeleteByIDForUser removes one identity; returns (false, nil) if no row matched.
func DeleteByIDForUser(ctx context.Context, pool *pgxpool.Pool, userID, identityID uuid.UUID) (bool, error) {
	cmd, err := pool.Exec(ctx, `DELETE FROM settings.user_oidc_identities WHERE id = $1 AND user_id = $2`, identityID, userID)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}
