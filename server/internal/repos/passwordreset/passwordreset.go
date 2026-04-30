// Package passwordreset ports server/src/repos/password_reset.rs.
package passwordreset

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TokenRow is a row from password_reset_tokens.
type TokenRow struct {
	ID        string
	UserID    string
	TokenHash []byte
	ExpiresAt time.Time
	UsedAt    *time.Time
}

// ReplaceTokenForUser deletes any existing reset tokens for the user and inserts a new one.
func ReplaceTokenForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, tokenHash []byte, expiresAt time.Time) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `DELETE FROM "user".password_reset_tokens WHERE user_id = $1`, userID.String())
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO "user".password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1::uuid, $2, $3)`,
		userID.String(), tokenHash, expiresAt,
	)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// FindByTokenHash looks up a reset token by SHA-256 hash of the raw token.
func FindByTokenHash(ctx context.Context, pool *pgxpool.Pool, tokenHash []byte) (*TokenRow, error) {
	const q = `SELECT id::text, user_id::text, token_hash, expires_at, used_at FROM "user".password_reset_tokens WHERE token_hash = $1`
	var r TokenRow
	err := pool.QueryRow(ctx, q, tokenHash).Scan(&r.ID, &r.UserID, &r.TokenHash, &r.ExpiresAt, &r.UsedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// MarkUsedAndSetPassword marks the token used and sets the user password. Returns false if the token was invalid or already used.
func MarkUsedAndSetPassword(ctx context.Context, pool *pgxpool.Pool, tokenID, userID uuid.UUID, passwordHash string) (bool, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
UPDATE "user".password_reset_tokens
SET used_at = NOW()
WHERE id = $1::uuid AND user_id = $2::uuid AND used_at IS NULL
`, tokenID.String(), userID.String())
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() != 1 {
		return false, nil
	}

	_, err = tx.Exec(ctx, `UPDATE "user".users SET password_hash = $2 WHERE id = $1::uuid`, userID.String(), passwordHash)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
