package oneroster

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server-new/internal/config"
)

// ResolveInstitutionFromBearer returns institution_id for a raw bearer token (trimmed).
func ResolveInstitutionFromBearer(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, rawToken string) (uuid.UUID, error) {
	t := trimBearer(rawToken)
	if t == "" {
		return uuid.UUID{}, errors.New("missing bearer")
	}
	h := sha256.Sum256([]byte(t))
	var inst uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT institution_id FROM settings.oneroster_bearer_credentials WHERE token_hash = $1
`, h[:]).Scan(&inst)
	if err == nil {
		return inst, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, err
	}
	fb := strings.TrimSpace(cfg.OneRosterBearerFallbackToken)
	if fb != "" && t == fb {
		idStr := strings.TrimSpace(cfg.OneRosterBearerFallbackInst)
		if idStr == "" {
			return uuid.UUID{}, errors.New("fallback institution not configured")
		}
		parsed, err := uuid.Parse(idStr)
		if err != nil {
			return uuid.UUID{}, errors.New("invalid ONEROSTER_BEARER_FALLBACK_INSTITUTION_ID")
		}
		return parsed, nil
	}
	return uuid.UUID{}, errors.New("invalid bearer")
}

func trimBearer(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 7 && strings.EqualFold(s[:7], "Bearer ") {
		return strings.TrimSpace(s[7:])
	}
	return s
}

// InsertBearerCredential stores SHA-256(rawToken).
func InsertBearerCredential(ctx context.Context, pool *pgxpool.Pool, institutionID uuid.UUID, label string, rawToken string) error {
	h := sha256.Sum256([]byte(strings.TrimSpace(rawToken)))
	_, err := pool.Exec(ctx, `
INSERT INTO settings.oneroster_bearer_credentials (institution_id, token_hash, label)
VALUES ($1, $2, $3)
`, institutionID, h[:], label)
	return err
}
