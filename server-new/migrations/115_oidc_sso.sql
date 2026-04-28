-- Plan 4.2 — OpenID Connect SSO (PKCE, JIT provisioning, optional custom providers).

CREATE TABLE settings.user_oidc_identities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    provider    TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'apple', 'custom')),
    sub         TEXT NOT NULL,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, sub)
);

CREATE INDEX idx_user_oidc_identities_user_id ON settings.user_oidc_identities (user_id);

CREATE TABLE settings.oidc_provider_configurations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  UUID,
    display_name    TEXT NOT NULL DEFAULT 'Custom IdP',
    provider        TEXT NOT NULL DEFAULT 'custom' CHECK (provider = 'custom'),
    client_id       TEXT NOT NULL,
    client_secret   TEXT NOT NULL,
    discovery_url   TEXT NOT NULL,
    hd_restriction  TEXT,
    attribute_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settings.oidc_flow_state (
    state           TEXT PRIMARY KEY,
    nonce           TEXT NOT NULL,
    code_verifier   TEXT NOT NULL,
    provider        TEXT NOT NULL,
    custom_config_id UUID REFERENCES settings.oidc_provider_configurations (id) ON DELETE SET NULL,
    for_user_id     UUID REFERENCES "user".users (id) ON DELETE CASCADE,
    next_path       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oidc_flow_state_created_at ON settings.oidc_flow_state (created_at);

CREATE TABLE settings.oidc_link_intents (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    provider   TEXT NOT NULL,
    custom_config_id UUID REFERENCES settings.oidc_provider_configurations (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oidc_link_intents_expires ON settings.oidc_link_intents (expires_at);

COMMENT ON TABLE settings.user_oidc_identities IS 'External OIDC subject per provider (plan 4.2).';
COMMENT ON TABLE settings.oidc_flow_state IS 'CSRF state + PKCE for OIDC; entries expire after ~10 min.';
