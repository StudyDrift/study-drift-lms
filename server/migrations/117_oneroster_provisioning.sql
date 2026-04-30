-- Plan 4.3 — OneRoster 1.2 CSV import + REST consumer (institution-scoped mappings, sync audit).

CREATE SCHEMA IF NOT EXISTS provisioning;

CREATE TABLE provisioning.oneroster_entity_mappings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  UUID NOT NULL,
    entity_type     TEXT NOT NULL CHECK (entity_type IN ('user', 'class', 'org', 'enrollment')),
    sourced_id      TEXT NOT NULL,
    lextures_id     UUID NOT NULL,
    last_synced_at  TIMESTAMPTZ,
    UNIQUE (institution_id, entity_type, sourced_id)
);

CREATE INDEX idx_oneroster_mappings_institution ON provisioning.oneroster_entity_mappings (institution_id);
CREATE INDEX idx_oneroster_mappings_lextures ON provisioning.oneroster_entity_mappings (institution_id, lextures_id, entity_type);

CREATE TABLE provisioning.oneroster_sync_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id      UUID NOT NULL,
    trigger             TEXT NOT NULL CHECK (trigger IN ('csv_upload', 'rest_push', 'scheduled')),
    status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    created_count       INT NOT NULL DEFAULT 0,
    updated_count       INT NOT NULL DEFAULT 0,
    deactivated_count   INT NOT NULL DEFAULT 0,
    error_count           INT NOT NULL DEFAULT 0,
    started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    error_message         TEXT
);

CREATE INDEX idx_oneroster_sync_runs_institution ON provisioning.oneroster_sync_runs (institution_id, started_at DESC);

CREATE TABLE provisioning.oneroster_sync_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES provisioning.oneroster_sync_runs (id) ON DELETE CASCADE,
    entity_type     TEXT NOT NULL,
    operation       TEXT NOT NULL CHECK (operation IN ('create', 'update', 'deactivate', 'skip', 'error')),
    sourced_id      TEXT,
    lextures_id     UUID,
    detail          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_oneroster_sync_events_run ON provisioning.oneroster_sync_events (run_id, created_at);

-- Bearer tokens for GET /oneroster/v1p2/* (SIS pulls); store SHA-256 of token at rest.
CREATE TABLE settings.oneroster_bearer_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  UUID NOT NULL,
    token_hash      BYTEA NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_oneroster_bearer_token_hash ON settings.oneroster_bearer_credentials (token_hash);

COMMENT ON TABLE provisioning.oneroster_entity_mappings IS 'OneRoster sourcedId → Lextures UUID per institution (plan 4.3).';
COMMENT ON TABLE settings.oneroster_bearer_credentials IS 'Hashed bearer tokens for OneRoster REST consumer endpoints.';

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS login_blocked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN "user".users.deactivated_at IS 'Set when account is soft-deactivated (e.g. OneRoster status=tobedeleted).';
COMMENT ON COLUMN "user".users.login_blocked IS 'When true, password and API login are rejected for this user.';

ALTER TABLE course.course_enrollments
    ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN course.course_enrollments.active IS 'False when enrollment is deactivated (e.g. OneRoster tobedeleted); row retained for history.';
