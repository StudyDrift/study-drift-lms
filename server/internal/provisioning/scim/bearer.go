// Package scim implements SCIM 2.0 service provider logic (RFC 7644) for user lifecycle.
package scim

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ResolveInstitutionFromBearer maps Authorization Bearer token to institution_id.
func ResolveInstitutionFromBearer(ctx context.Context, pool *pgxpool.Pool, rawToken string) (uuid.UUID, error) {
	t := trimBearer(rawToken)
	if t == "" {
		return uuid.UUID{}, errors.New("missing bearer")
	}
	h := sha256.Sum256([]byte(t))
	var inst uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT institution_id FROM settings.scim_bearer_tokens
WHERE token_hash = $1 AND revoked_at IS NULL
`, h[:]).Scan(&inst)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.UUID{}, errors.New("invalid bearer")
		}
		return uuid.UUID{}, err
	}
	return inst, nil
}

func trimBearer(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 7 && strings.EqualFold(s[:7], "Bearer ") {
		return strings.TrimSpace(s[7:])
	}
	return s
}

// InsertBearerToken stores SHA-256(rawToken); returns new row id.
func InsertBearerToken(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, label, rawToken string) (uuid.UUID, error) {
	h := sha256.Sum256([]byte(strings.TrimSpace(rawToken)))
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
INSERT INTO settings.scim_bearer_tokens (institution_id, token_hash, label)
VALUES ($1, $2, $3)
RETURNING id
`, institutionID, h[:], strings.TrimSpace(label)).Scan(&id)
	return id, err
}

// RevokeBearerToken marks a token revoked by id (scoped to institution when non-nil).
func RevokeBearerToken(ctx context.Context, pool *pgxpool.Pool, tokenID uuid.UUID, institutionID *uuid.UUID) (bool, error) {
	var tag interface {
		RowsAffected() int64
	}
	var err error
	if institutionID != nil {
		tag, err = pool.Exec(ctx, `
UPDATE settings.scim_bearer_tokens SET revoked_at = NOW()
WHERE id = $1 AND institution_id = $2 AND revoked_at IS NULL
`, tokenID, *institutionID)
	} else {
		tag, err = pool.Exec(ctx, `
UPDATE settings.scim_bearer_tokens SET revoked_at = NOW()
WHERE id = $1 AND revoked_at IS NULL
`, tokenID)
	}
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
