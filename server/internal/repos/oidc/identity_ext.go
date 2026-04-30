package oidc

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IdentityForLogin is a row in settings.user_oidc_identities (for subject lookup).
type IdentityForLogin struct {
	ID     uuid.UUID
	UserID uuid.UUID
}

// FindIdentityByProviderAndSub returns the link row for (provider, sub), or (nil, nil) if none.
func FindIdentityByProviderAndSub(ctx context.Context, pool *pgxpool.Pool, provider, sub string) (*IdentityForLogin, error) {
	var id, uid uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT id, user_id
FROM settings.user_oidc_identities
WHERE provider = $1 AND sub = $2`,
		provider, sub,
	).Scan(&id, &uid)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &IdentityForLogin{ID: id, UserID: uid}, nil
}

// TryInsertIdentity inserts a new (provider, sub) link; returns true if a new row was inserted.
func TryInsertIdentity(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, provider, sub string, email *string) (bool, error) {
	cmd, err := pool.Exec(ctx, `
INSERT INTO settings.user_oidc_identities (user_id, provider, sub, email)
VALUES ($1, $2, $3, $4)
ON CONFLICT (provider, sub) DO NOTHING`,
		userID, provider, sub, email,
	)
	if err != nil {
		return false, err
	}
	return cmd.RowsAffected() > 0, nil
}
