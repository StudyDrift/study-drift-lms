// Package refreshtoken stores and revokes opaque refresh tokens (plan 4.8).
package refreshtoken

import (
	"context"
	"errors"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is a persisted refresh token (plaintext never stored).
type Row struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	ExpiresAt       time.Time
	UserAgent       *string
	AuthMethod      *string
	LocationCity    *string
	LocationCountry *string
}

// SessionRow is an active refresh token row for session management UI (plan 4.9).
type SessionRow struct {
	ID                uuid.UUID
	CreatedAt         time.Time
	LastRefreshedAt  *time.Time
	UserAgent         *string
	AuthMethod        *string
	LocationCity      *string
	LocationCountry   *string
}

// Insert creates a row for a SHA-256 token hash (32 bytes).
func Insert(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, tokenHash []byte, expiresAt time.Time, userAgent string, ip net.IP, authMethod *string, locCity, locCountry *string) (uuid.UUID, error) {
	return insert(ctx, pool, userID, tokenHash, expiresAt, userAgent, ip, authMethod, locCity, locCountry, nil)
}

// InsertTx is Insert within an existing transaction.
func InsertTx(ctx context.Context, tx pgx.Tx, userID uuid.UUID, tokenHash []byte, expiresAt time.Time, userAgent string, ip net.IP, authMethod *string, locCity, locCountry *string) (uuid.UUID, error) {
	return insert(ctx, tx, userID, tokenHash, expiresAt, userAgent, ip, authMethod, locCity, locCountry, nil)
}

// InsertTxWithLastRefreshed is like InsertTx but sets last_refreshed_at (token issued from refresh rotation).
func InsertTxWithLastRefreshed(ctx context.Context, tx pgx.Tx, userID uuid.UUID, tokenHash []byte, expiresAt time.Time, userAgent string, ip net.IP, authMethod *string, locCity, locCountry *string, lastRefreshedAt time.Time) (uuid.UUID, error) {
	t := lastRefreshedAt.UTC()
	return insert(ctx, tx, userID, tokenHash, expiresAt, userAgent, ip, authMethod, locCity, locCountry, &t)
}

type inserter interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func insert(ctx context.Context, db inserter, userID uuid.UUID, tokenHash []byte, expiresAt time.Time, userAgent string, ip net.IP, authMethod *string, locCity, locCountry *string, lastRefreshedAt *time.Time) (uuid.UUID, error) {
	var id uuid.UUID
	var ua any
	if userAgent != "" {
		ua = userAgent
	}
	var ipArg any
	if ip != nil {
		ipArg = ip.String()
	}
	var am any
	if authMethod != nil && strings.TrimSpace(*authMethod) != "" {
		am = strings.TrimSpace(*authMethod)
	}
	var city, country any
	if locCity != nil && strings.TrimSpace(*locCity) != "" {
		city = strings.TrimSpace(*locCity)
	}
	if locCountry != nil && strings.TrimSpace(*locCountry) != "" {
		country = strings.TrimSpace(*locCountry)
	}
	var lr any
	if lastRefreshedAt != nil {
		lr = lastRefreshedAt.UTC()
	}
	err := db.QueryRow(ctx, `
INSERT INTO "user".refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address, auth_method, location_city, location_country, last_refreshed_at)
VALUES ($1, $2, $3, $4, $5::inet, $6, $7, $8, $9)
RETURNING id
`, userID, tokenHash, expiresAt.UTC(), ua, ipArg, am, city, country, lr).Scan(&id)
	return id, err
}

// FindActiveByHashForUpdate returns a non-revoked, unexpired row and locks it (rotation / replay safety).
func FindActiveByHashForUpdate(ctx context.Context, tx pgx.Tx, tokenHash []byte, now time.Time) (*Row, error) {
	var r Row
	err := tx.QueryRow(ctx, `
SELECT id, user_id, expires_at, user_agent, auth_method, location_city, location_country
FROM "user".refresh_tokens
WHERE token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > $2
FOR UPDATE
`, tokenHash, now.UTC()).Scan(&r.ID, &r.UserID, &r.ExpiresAt, &r.UserAgent, &r.AuthMethod, &r.LocationCity, &r.LocationCountry)
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

// ListActiveSessionsForUser returns non-revoked, unexpired sessions for the user (plan 4.9).
func ListActiveSessionsForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, now time.Time) ([]SessionRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, created_at, last_refreshed_at, user_agent, auth_method, location_city, location_country
FROM "user".refresh_tokens
WHERE user_id = $1
  AND revoked_at IS NULL
  AND expires_at > $2
ORDER BY COALESCE(last_refreshed_at, created_at) DESC, created_at DESC
`, userID, now.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionRow
	for rows.Next() {
		var r SessionRow
		if err := rows.Scan(&r.ID, &r.CreatedAt, &r.LastRefreshedAt, &r.UserAgent, &r.AuthMethod, &r.LocationCity, &r.LocationCountry); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// TouchLastRefreshed sets last_refreshed_at for an active token row (plan 4.9).
func TouchLastRefreshed(ctx context.Context, exec pgx.Tx, id uuid.UUID, at, now time.Time) error {
	_, err := exec.Exec(ctx, `
UPDATE "user".refresh_tokens
SET last_refreshed_at = $2
WHERE id = $1 AND revoked_at IS NULL AND expires_at > $3
`, id, at.UTC(), now.UTC())
	return err
}

// RevokeForUserExcept marks revoked_at for all active tokens of the user except exceptID.
func RevokeForUserExcept(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, exceptID *uuid.UUID, at time.Time) error {
	if exceptID == nil {
		return RevokeAllForUser(ctx, pool, userID, at)
	}
	_, err := pool.Exec(ctx, `
UPDATE "user".refresh_tokens SET revoked_at = $3
WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2::uuid
`, userID, *exceptID, at.UTC())
	return err
}

// RevokeByIDForUser sets revoked_at for one row when it belongs to the user and is still active.
func RevokeByIDForUser(ctx context.Context, pool *pgxpool.Pool, userID, tokenID uuid.UUID, at time.Time) (bool, error) {
	t := at.UTC()
	tag, err := pool.Exec(ctx, `
UPDATE "user".refresh_tokens SET revoked_at = $3
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > $3
`, tokenID, userID, t)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
