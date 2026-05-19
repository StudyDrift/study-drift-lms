// Package supportwidget stores per-org help widget configuration (plan 6.8).
package supportwidget

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row represents a tenant.org_support_widget row.
type Row struct {
	OrgID          uuid.UUID
	Enabled        bool
	Provider       string // "crisp" | "intercom" | "none"
	WebsiteID      *string
	DPAConfirmedAt *time.Time
	UpdatedAt      time.Time
}

// Get returns the widget config for an org, or (nil, nil) if no row exists yet.
func Get(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID) (*Row, error) {
	row := pool.QueryRow(ctx, `
SELECT org_id, enabled, provider, website_id, dpa_confirmed_at, updated_at
FROM tenant.org_support_widget
WHERE org_id = $1
`, orgID)
	r, err := scan(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

// Upsert inserts or replaces the widget config for an org.
func Upsert(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, enabled bool, provider string, websiteID *string, dpaConfirmedAt *time.Time) error {
	_, err := pool.Exec(ctx, `
INSERT INTO tenant.org_support_widget (org_id, enabled, provider, website_id, dpa_confirmed_at, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (org_id) DO UPDATE SET
    enabled          = EXCLUDED.enabled,
    provider         = EXCLUDED.provider,
    website_id       = EXCLUDED.website_id,
    dpa_confirmed_at = EXCLUDED.dpa_confirmed_at,
    updated_at       = now()
`, orgID, enabled, provider, websiteID, dpaConfirmedAt)
	return err
}

func scan(row pgx.Row) (*Row, error) {
	var r Row
	var websiteID *string
	var dpaConfirmedAt *time.Time
	if err := row.Scan(&r.OrgID, &r.Enabled, &r.Provider, &websiteID, &dpaConfirmedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	r.WebsiteID = websiteID
	r.DPAConfirmedAt = dpaConfirmedAt
	return &r, nil
}
