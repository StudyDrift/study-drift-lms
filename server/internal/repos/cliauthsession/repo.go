// Package cliauthsession stores pending CLI browser-auth sessions.
package cliauthsession

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is a cli_auth_sessions row.
type Row struct {
	TokenHash    []byte
	AccessToken  *string
	RefreshToken *string
	ExpiresIn    *int
	ExpiresAt    time.Time
	ApprovedAt   *time.Time
	CreatedAt    time.Time
}

// Insert creates a new pending CLI auth session.
func Insert(ctx context.Context, pool *pgxpool.Pool, tokenHash []byte, expiresAt time.Time) error {
	_, err := pool.Exec(ctx, `
INSERT INTO "user".cli_auth_sessions (token_hash, expires_at)
VALUES ($1, $2)
`, tokenHash, expiresAt)
	return err
}

// FindActiveByTokenHash returns a pending (not expired) session, or nil if none.
func FindActiveByTokenHash(ctx context.Context, pool *pgxpool.Pool, tokenHash []byte, now time.Time) (*Row, error) {
	const q = `
SELECT token_hash, access_token, refresh_token, expires_in, expires_at, approved_at, created_at
FROM "user".cli_auth_sessions
WHERE token_hash = $1 AND expires_at > $2`
	var r Row
	err := pool.QueryRow(ctx, q, tokenHash, now).Scan(
		&r.TokenHash, &r.AccessToken, &r.RefreshToken, &r.ExpiresIn, &r.ExpiresAt, &r.ApprovedAt, &r.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// Approve stores the issued tokens against the session.
func Approve(ctx context.Context, pool *pgxpool.Pool, tokenHash []byte, accessToken, refreshToken string, expiresIn int) error {
	tag, err := pool.Exec(ctx, `
UPDATE "user".cli_auth_sessions
SET access_token = $2, refresh_token = $3, expires_in = $4, approved_at = NOW()
WHERE token_hash = $1 AND approved_at IS NULL AND expires_at > NOW()
`, tokenHash, accessToken, refreshToken, expiresIn)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("session not found or already approved")
	}
	return nil
}
