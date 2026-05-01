-- Plan 4.4 — Clever / ClassLink: external IDs, minor flag, district Clever config, OIDC providers.

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS clever_id TEXT,
    ADD COLUMN IF NOT EXISTS classlink_id TEXT,
    ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS users_clever_id_unique
    ON "user".users (clever_id) WHERE clever_id IS NOT NULL AND trim(clever_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS users_classlink_id_unique
    ON "user".users (classlink_id) WHERE classlink_id IS NOT NULL AND trim(classlink_id) <> '';

COMMENT ON COLUMN "user".users.clever_id IS 'Clever multi-role user id (v3.0); plan 4.4.';
COMMENT ON COLUMN "user".users.classlink_id IS 'ClassLink OIDC subject; plan 4.4.';
COMMENT ON COLUMN "user".users.is_minor IS 'COPPA-style minor flag (e.g. Clever is_under_13); plan 4.4.';

CREATE TABLE settings.clever_district_configurations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    district_id     TEXT NOT NULL UNIQUE,
    client_id       TEXT NOT NULL,
    client_secret   TEXT NOT NULL,
    sync_schedule   TEXT NOT NULL DEFAULT 'daily' CHECK (sync_schedule IN ('hourly', 'daily')),
    last_synced_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE settings.clever_district_configurations IS 'Per-district Clever API credentials for Secure Sync (plan 4.4).';

CREATE TABLE settings.clever_sso_flow_state (
    state           TEXT PRIMARY KEY,
    code_verifier   TEXT NOT NULL,
    next_path       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clever_sso_flow_state_created_at ON settings.clever_sso_flow_state (created_at);

COMMENT ON TABLE settings.clever_sso_flow_state IS 'PKCE verifier + optional next path for Clever OAuth (plan 4.4).';
