// Package magiclinktoken stores one-time magic-link login tokens (plan 4.7).
package magiclinktoken

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is a magic_link_tokens row.
type Row struct {
	ID          string
	UserID      string
	TokenHash   []byte
	ExpiresAt   time.Time
	ConsumedAt  *time.Time
	RedirectTo  *string
	CreatedAt   time.Time
}

// CountRecentRequestsForUser returns rows created in the last window for rate limiting.
func CountRecentRequestsForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, window time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-window)
	var n int64
	err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint FROM "user".magic_link_tokens
WHERE user_id = $1::uuid AND created_at > $2
`, userID.String(), cutoff).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// Insert creates a new unconsumed token row.
func Insert(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, tokenHash []byte, expiresAt time.Time, redirectTo *string) error {
	_, err := pool.Exec(ctx, `
INSERT INTO "user".magic_link_tokens (user_id, token_hash, expires_at, redirect_to)
VALUES ($1::uuid, $2, $3, $4)
`, userID.String(), tokenHash, expiresAt, redirectTo)
	return err
}

// FindActiveByTokenHash returns an unconsumed, unexpired row for the hash, if any.
func FindActiveByTokenHash(ctx context.Context, pool *pgxpool.Pool, tokenHash []byte, now time.Time) (*Row, error) {
	const q = `
SELECT id::text, user_id::text, token_hash, expires_at, consumed_at, redirect_to, created_at
FROM "user".magic_link_tokens
WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2`
	var r Row
	err := pool.QueryRow(ctx, q, tokenHash, now).Scan(
		&r.ID, &r.UserID, &r.TokenHash, &r.ExpiresAt, &r.ConsumedAt, &r.RedirectTo, &r.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// FindByTokenHash returns any row with this hash (for distinguishing expired/consumed vs unknown).
func FindByTokenHash(ctx context.Context, pool *pgxpool.Pool, tokenHash []byte) (*Row, error) {
	const q = `
SELECT id::text, user_id::text, token_hash, expires_at, consumed_at, redirect_to, created_at
FROM "user".magic_link_tokens WHERE token_hash = $1`
	var r Row
	err := pool.QueryRow(ctx, q, tokenHash).Scan(
		&r.ID, &r.UserID, &r.TokenHash, &r.ExpiresAt, &r.ConsumedAt, &r.RedirectTo, &r.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// MarkConsumed sets consumed_at if still null (single-use).
func MarkConsumed(ctx context.Context, pool *pgxpool.Pool, tokenID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `
UPDATE "user".magic_link_tokens SET consumed_at = NOW()
WHERE id = $1::uuid AND consumed_at IS NULL
`, tokenID.String())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
