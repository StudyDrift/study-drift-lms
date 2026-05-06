// Package orgbranding stores per-tenant branding (plan 5.7).
package orgbranding

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultPrimaryHex and DefaultSecondaryHex match migration defaults.
const (
	DefaultPrimaryHex   = "#4F46E5"
	DefaultSecondaryHex = "#7C3AED"
)

// Row is a tenant.org_branding row.
type Row struct {
	OrgID                  uuid.UUID
	LogoURL                *string
	FaviconURL             *string
	PrimaryColor           string
	SecondaryColor         string
	CustomDomain           *string
	CustomEmailDisplayName *string
	UpdatedAt              time.Time
}

func strPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	s := strings.TrimSpace(ns.String)
	if s == "" {
		return nil
	}
	return &s
}

// Get returns branding for an org, or (nil, nil) if the org has no row yet.
func Get(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID) (*Row, error) {
	row := pool.QueryRow(ctx, `
SELECT org_id, logo_url, favicon_url, primary_color, secondary_color, custom_domain, custom_email_display_name, updated_at
FROM tenant.org_branding
WHERE org_id = $1
`, orgID)
	return scanRow(row)
}

func scanRow(row pgx.Row) (*Row, error) {
	var r Row
	var logo, fav, dom, email sql.NullString
	err := row.Scan(&r.OrgID, &logo, &fav, &r.PrimaryColor, &r.SecondaryColor, &dom, &email, &r.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	r.LogoURL = strPtr(logo)
	r.FaviconURL = strPtr(fav)
	r.CustomDomain = strPtr(dom)
	r.CustomEmailDisplayName = strPtr(email)
	return &r, nil
}

// UpsertReplace inserts or replaces all branding columns for an org.
func UpsertReplace(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID, logoURL, faviconURL *string, primaryHex, secondaryHex string, customDomain, emailDisplay *string) error {
	p1 := strings.TrimSpace(primaryHex)
	if p1 == "" {
		p1 = DefaultPrimaryHex
	}
	p2 := strings.TrimSpace(secondaryHex)
	if p2 == "" {
		p2 = DefaultSecondaryHex
	}
	var dom any
	if customDomain != nil {
		d := strings.TrimSpace(strings.ToLower(*customDomain))
		if d != "" {
			dom = d
		} else {
			dom = nil
		}
	} else {
		dom = nil
	}
	_, err := pool.Exec(ctx, `
INSERT INTO tenant.org_branding (org_id, logo_url, favicon_url, primary_color, secondary_color, custom_domain, custom_email_display_name, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
ON CONFLICT (org_id) DO UPDATE SET
  logo_url = EXCLUDED.logo_url,
  favicon_url = EXCLUDED.favicon_url,
  primary_color = EXCLUDED.primary_color,
  secondary_color = EXCLUDED.secondary_color,
  custom_domain = EXCLUDED.custom_domain,
  custom_email_display_name = EXCLUDED.custom_email_display_name,
  updated_at = NOW()
`, orgID, strOrNil(logoURL), strOrNil(faviconURL), p1, p2, dom, strOrNil(emailDisplay))
	return err
}

func strOrNil(p *string) any {
	if p == nil {
		return nil
	}
	s := strings.TrimSpace(*p)
	if s == "" {
		return nil
	}
	return s
}

// OrgIDForSlug resolves org id by organizations.slug (case-insensitive).
func OrgIDForSlug(ctx context.Context, pool *pgxpool.Pool, slug string) (*uuid.UUID, error) {
	slug = strings.TrimSpace(strings.ToLower(slug))
	if slug == "" {
		return nil, nil
	}
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT id FROM tenant.organizations WHERE LOWER(slug) = $1 AND status <> 'deleted'
`, slug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// OrgIDForCustomDomain resolves org id via org_branding.custom_domain (case-insensitive).
func OrgIDForCustomDomain(ctx context.Context, pool *pgxpool.Pool, host string) (*uuid.UUID, error) {
	h := NormalizeHost(host)
	if h == "" {
		return nil, nil
	}
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT org_id FROM tenant.org_branding WHERE LOWER(TRIM(custom_domain)) = $1
`, h).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// OrgSlug returns slug for an org id (for logging).
func OrgSlug(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID) (string, error) {
	var slug string
	err := pool.QueryRow(ctx, `SELECT slug FROM tenant.organizations WHERE id = $1`, orgID).Scan(&slug)
	if err != nil {
		return "", err
	}
	return slug, nil
}

// NormalizeHost strips port and lowercases for host comparisons.
func NormalizeHost(host string) string {
	h := strings.TrimSpace(strings.ToLower(host))
	if h == "" {
		return ""
	}
	if strings.HasPrefix(h, "[") {
		if j := strings.LastIndex(h, "]:"); j >= 0 {
			h = h[:j+1]
		}
		return strings.TrimPrefix(strings.TrimSuffix(h, "]"), "[")
	}
	if i := strings.IndexByte(h, ':'); i >= 0 {
		h = h[:i]
	}
	return h
}
