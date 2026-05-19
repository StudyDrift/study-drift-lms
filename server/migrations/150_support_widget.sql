-- Plan 6.8: In-context Help & Live Chat Support
-- Org-level configuration for the help widget.
-- Provider is one of: crisp, intercom, none.

CREATE TABLE IF NOT EXISTS tenant.org_support_widget (
    org_id           UUID PRIMARY KEY REFERENCES tenant.organizations(id) ON DELETE CASCADE,
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    provider         TEXT NOT NULL DEFAULT 'crisp'
                       CHECK (provider IN ('crisp','intercom','none')),
    website_id       TEXT,
    dpa_confirmed_at TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
