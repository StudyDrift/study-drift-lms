// Package refreshtoken stores and revokes opaque refresh tokens (plan 4.8).
package refreshtoken

import (
	"context"
	"errors"
	"net"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is a persisted refresh token (plaintext never stored).
type Row struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	ExpiresAt time.Time
}

// Insert creates a row for a SHA-256 token hash (32 bytes).
func Insert(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, tokenHash []byte, expiresAt time.Time, userAgent string, ip net.IP) (uuid.UUID, error) {
	return insert(ctx, pool, userID, tokenHash, expiresAt, userAgent, ip)
}

// InsertTx is Insert within an existing transaction.
func InsertTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, tokenHash []byte, expiresAt time.Time, userAgent string, ip net.IP) (uuid.UUID, error) {
	return insert(ctx, tx, userID, tokenHash, expiresAt, userAgent, ip)
}

type inserter interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func insert(ctx context.Context, db inserter, userID uuid.UUID, tokenHash []byte, expiresAt time.Time, userAgent string, ip net.IP) (uuid.UUID, error) {
	var id uuid.UUID
	var ua any
	if userAgent != "" {
		ua = userAgent
	}
	var ipArg any
	if ip != nil {
		ipArg = ip.String()
	}
	err := db.QueryRow(ctx, `
INSERT INTO "user".refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
VALUES ($1, $2, $3, $4, $5::inet)
RETURNING id
`, userID, tokenHash, expiresAt.UTC(), ua, ipArg).Scan(&id)
	return id, err
}

// FindActiveByHashForUpdate returns a non-revoked, unexpired row and locks it (rotation / replay safety).
func FindActiveByHashForUpdate(ctx context.Context, tx pgx.Tx, tokenHash []byte, now time.Time) (*Row, error) {
	var r Row
	err := tx.QueryRow(ctx, `
SELECT id, user_id, expires_at
FROM "user".refresh_tokens
WHERE token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > $2
FOR UPDATE
`, tokenHash, now.UTC()).Scan(&r.ID, &r.UserID, &r.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// MarkRevoked sets revoked_at when still null (idempotent).
func MarkRevoked(ctx context.Context, exec pgx.Tx, id uuid.UUID, at time.Time) error {
	_, err := exec.Exec(ctx, `
UPDATE "user".refresh_tokens SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL
`, id, at.UTC())
	return err
}

// RevokeAllForUser marks every non-revoked token for the user revoked.
func RevokeAllForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, at time.Time) error {
	_, err := pool.Exec(ctx, `
UPDATE "user".refresh_tokens SET revoked_at = $2
WHERE user_id = $1 AND revoked_at IS NULL
`, userID, at.UTC())
	return err
}

// RevokeAllForUserTx is RevokeAllForUser within a transaction.
func RevokeAllForUserTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, at time.Time) error {
	_, err := tx.Exec(ctx, `
UPDATE "user".refresh_tokens SET revoked_at = $2
WHERE user_id = $1 AND revoked_at IS NULL
`, userID, at.UTC())
	return err
}
