package oidc

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CustomProviderRow is a row in settings.oidc_provider_configurations (admin list/upsert).
type CustomProviderRow struct {
	ID               uuid.UUID
	InstitutionID    *uuid.UUID
	DisplayName      string
	ClientID         string
	ClientSecret     string
	DiscoveryURL     string
	HDRestriction    *string
	AttributeMapping json.RawMessage
}

// GetCustomByID returns one custom configuration or nil.
func GetCustomByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*CustomProviderRow, error) {
	var r CustomProviderRow
	var am []byte
	err := pool.QueryRow(ctx, `
SELECT id, institution_id, display_name, client_id, client_secret, discovery_url, hd_restriction, attribute_mapping
FROM settings.oidc_provider_configurations
WHERE id = $1`, id,
	).Scan(&r.ID, &r.InstitutionID, &r.DisplayName, &r.ClientID, &r.ClientSecret, &r.DiscoveryURL, &r.HDRestriction, &am)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if len(am) == 0 {
		am = []byte(`{}`)
	}
	r.AttributeMapping = am
	return &r, nil
}

// ListCustomConfigs returns all custom IdP providers for admin.
func ListCustomConfigs(ctx context.Context, pool *pgxpool.Pool) ([]CustomProviderRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, institution_id, display_name, client_id, client_secret, discovery_url, hd_restriction, attribute_mapping
FROM settings.oidc_provider_configurations
ORDER BY display_name
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CustomProviderRow
	for rows.Next() {
		var r CustomProviderRow
		var am []byte
		if err := rows.Scan(
			&r.ID, &r.InstitutionID, &r.DisplayName, &r.ClientID, &r.ClientSecret, &r.DiscoveryURL, &r.HDRestriction, &am,
		); err != nil {
			return nil, err
		}
		if len(am) == 0 {
			am = []byte(`{}`)
		}
		r.AttributeMapping = am
		out = append(out, r)
	}
	return out, rows.Err()
}

// CustomConfigWrite is the upsert payload.
type CustomConfigWrite struct {
	InstitutionID    *uuid.UUID
	DisplayName      string
	ClientID         string
	ClientSecret     string
	DiscoveryURL     string
	HDRestriction    *string
	AttributeMapping json.RawMessage
}

// UpsertCustomConfig insert or full update; returns the row id.
func UpsertCustomConfig(ctx context.Context, pool *pgxpool.Pool, id *uuid.UUID, w *CustomConfigWrite) (uuid.UUID, error) {
	if w == nil {
		return uuid.UUID{}, errors.New("oidc: nil write")
	}
	if id != nil {
		_, err := pool.Exec(ctx, `
UPDATE settings.oidc_provider_configurations
SET institution_id = $2, display_name = $3, client_id = $4, client_secret = $5, discovery_url = $6, hd_restriction = $7, attribute_mapping = $8, updated_at = NOW()
WHERE id = $1
`, *id, w.InstitutionID, w.DisplayName, w.ClientID, w.ClientSecret, w.DiscoveryURL, w.HDRestriction, w.AttributeMapping)
		if err != nil {
			return uuid.UUID{}, err
		}
		return *id, nil
	}
	var out uuid.UUID
	err := pool.QueryRow(ctx, `
INSERT INTO settings.oidc_provider_configurations (institution_id, display_name, client_id, client_secret, discovery_url, hd_restriction, attribute_mapping)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id
`, w.InstitutionID, w.DisplayName, w.ClientID, w.ClientSecret, w.DiscoveryURL, w.HDRestriction, w.AttributeMapping).Scan(&out)
	return out, err
}

// HasClientSecret is true if a non-empty secret is stored.
func (r *CustomProviderRow) HasClientSecret() bool { return strings.TrimSpace(r.ClientSecret) != "" }
