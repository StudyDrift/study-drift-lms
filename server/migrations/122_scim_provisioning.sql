-- Plan 4.5 — SCIM 2.0 provisioning (bearer tokens, audit log, external id).

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS scim_external_id TEXT,
    ADD COLUMN IF NOT EXISTS jwt_session_version BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_scim_external_id_unique
    ON "user".users (scim_external_id)
    WHERE scim_external_id IS NOT NULL AND trim(scim_external_id) <> '';

COMMENT ON COLUMN "user".users.scim_external_id IS 'SCIM externalId from IdP (plan 4.5).';
COMMENT ON COLUMN "user".users.jwt_session_version IS 'Incremented to revoke outstanding login JWTs (SCIM deprovision, etc.).';

CREATE TABLE IF NOT EXISTS settings.scim_bearer_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  UUID NOT NULL,
    token_hash      BYTEA NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scim_bearer_token_hash
    ON settings.scim_bearer_tokens (token_hash)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scim_bearer_tokens_institution
    ON settings.scim_bearer_tokens (institution_id)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE settings.scim_bearer_tokens IS 'Hashed bearer tokens for SCIM IdP provisioning (plan 4.5).';

CREATE TABLE IF NOT EXISTS provisioning.scim_provisioning_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id   UUID NOT NULL,
    operation        TEXT NOT NULL CHECK (operation IN ('create', 'update', 'deactivate', 'delete')),
    scim_resource    TEXT NOT NULL,
    affected_user_id UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    payload_json     JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scim_events_institution_created
    ON provisioning.scim_provisioning_events (institution_id, created_at DESC);

COMMENT ON TABLE provisioning.scim_provisioning_events IS 'Audit log for SCIM provisioning actions (plan 4.5).';

-- Users provisioned via SCIM for an institution (multi-tenant isolation without institution_id on users).
CREATE TABLE IF NOT EXISTS provisioning.scim_user_bindings (
    institution_id UUID NOT NULL,
    user_id        UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    PRIMARY KEY (institution_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_scim_bindings_user ON provisioning.scim_user_bindings (user_id);

COMMENT ON TABLE provisioning.scim_user_bindings IS 'Maps Lextures users to SCIM institution scope (plan 4.5).';

ALTER TABLE settings.platform_app_settings
    ADD COLUMN IF NOT EXISTS scim_enabled BOOLEAN;
