// Package originalityconfig maps server/src/repos/originality_platform_config.rs.
package originalityconfig

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Write is the upsert payload for the singleton config row.
type Write struct {
	DpaAcceptedAt          *time.Time
	ActiveExternalProvider string
	ProviderAPIKey         *string
	WebhookHMACSecret      *string
	SimilarityAmberMinPct  float64
	SimilarityRedMinPct    float64
	AIAmberMinPct         float64
	AIRedMinPct            float64
}

// UpsertSingleton sets row id=1; matches the Rust `upsert_singleton` SQL.
func UpsertSingleton(ctx context.Context, pool *pgxpool.Pool, w *Write) error {
	_, err := pool.Exec(ctx, `
INSERT INTO settings.originality_platform_config (
	id, dpa_accepted_at, active_external_provider, provider_api_key, webhook_hmac_secret,
	similarity_amber_min_pct, similarity_red_min_pct, ai_amber_min_pct, ai_red_min_pct, updated_at
)
VALUES (
	1, $1, $2, $3, $4, $5, $6, $7, $8, NOW()
)
ON CONFLICT (id) DO UPDATE SET
	dpa_accepted_at = EXCLUDED.dpa_accepted_at,
	active_external_provider = EXCLUDED.active_external_provider,
	provider_api_key = EXCLUDED.provider_api_key,
	webhook_hmac_secret = EXCLUDED.webhook_hmac_secret,
	similarity_amber_min_pct = EXCLUDED.similarity_amber_min_pct,
	similarity_red_min_pct = EXCLUDED.similarity_red_min_pct,
	ai_amber_min_pct = EXCLUDED.ai_amber_min_pct,
	ai_red_min_pct = EXCLUDED.ai_red_min_pct,
	updated_at = NOW()
`, w.DpaAcceptedAt, w.ActiveExternalProvider, w.ProviderAPIKey, w.WebhookHMACSecret,
		w.SimilarityAmberMinPct, w.SimilarityRedMinPct, w.AIAmberMinPct, w.AIRedMinPct,
	)
	return err
}

// Row is a read of the singleton config row.
type Row struct {
	WebhookHMACSecret *string
}

// GetSingleton returns the row id=1, or (nil, nil) if the row is missing.
func GetSingleton(ctx context.Context, pool *pgxpool.Pool) (*Row, error) {
	var r Row
	err := pool.QueryRow(ctx, `
SELECT webhook_hmac_secret
FROM settings.originality_platform_config
WHERE id = 1
`).Scan(&r.WebhookHMACSecret)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}
