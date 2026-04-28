-- Plan 4.1 — SAML 2.0 SSO: IdP configuration, AuthnRequest correlation, replay protection.

CREATE TABLE settings.saml_idp_configurations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  UUID,
    display_name    TEXT NOT NULL DEFAULT 'Institution',
    entity_id       TEXT NOT NULL UNIQUE,
    sso_url         TEXT NOT NULL,
    slo_url         TEXT,
    idp_cert_pem    TEXT NOT NULL,
    attribute_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    force_saml      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE settings.saml_authn_request_state (
    request_id  TEXT PRIMARY KEY,
    idp_id      UUID NOT NULL REFERENCES settings.saml_idp_configurations (id) ON DELETE CASCADE,
    relay_state TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_saml_authn_request_state_created
    ON settings.saml_authn_request_state (created_at);

COMMENT ON TABLE settings.saml_idp_configurations IS 'SAML IdP trust — SP-initiated and IdP-initiated SSO (plan 4.1).';
COMMENT ON COLUMN settings.saml_idp_configurations.idp_cert_pem IS 'IdP X.509 certificate PEM (protect at rest in production; see security hardening / KMS).';

-- Prevents re-use of the same InResponseTo / AuthnRequest correlation (plan AC-7).
CREATE TABLE settings.saml_replay_guard (
    correlation_id TEXT PRIMARY KEY,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_saml_replay_guard_created ON settings.saml_replay_guard (created_at);
