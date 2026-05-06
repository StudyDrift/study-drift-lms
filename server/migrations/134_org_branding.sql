-- Plan 5.7 — Per-organization branding (logo, colors, custom domain mapping).

CREATE TABLE tenant.org_branding (
    org_id                     UUID PRIMARY KEY REFERENCES tenant.organizations (id) ON DELETE CASCADE,
    logo_url                   TEXT,
    favicon_url                TEXT,
    primary_color              TEXT NOT NULL DEFAULT '#4F46E5',
    secondary_color            TEXT NOT NULL DEFAULT '#7C3AED',
    custom_domain              TEXT,
    custom_email_display_name  TEXT,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_org_branding_custom_domain_lower
    ON tenant.org_branding (LOWER(TRIM(custom_domain)))
    WHERE custom_domain IS NOT NULL AND TRIM(custom_domain) <> '';

COMMENT ON TABLE tenant.org_branding IS 'Org-level branding and optional custom hostname mapping (plan 5.7).';
