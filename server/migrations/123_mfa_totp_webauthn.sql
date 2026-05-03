-- MFA: TOTP, WebAuthn/passkeys, backup codes, enforcement (plan 4.6).

CREATE TABLE IF NOT EXISTS "user".mfa_totp_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    label TEXT,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    last_used_period BIGINT,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mfa_totp_user ON "user".mfa_totp_credentials (user_id);

CREATE TABLE IF NOT EXISTS "user".mfa_webauthn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL UNIQUE,
    public_key_cbor BYTEA NOT NULL,
    sign_count BIGINT NOT NULL DEFAULT 0,
    display_name TEXT,
    aaguid UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mfa_webauthn_user ON "user".mfa_webauthn_credentials (user_id);

CREATE TABLE IF NOT EXISTS "user".mfa_backup_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX idx_mfa_backup_user ON "user".mfa_backup_codes (user_id);

CREATE TABLE IF NOT EXISTS "user".mfa_pending_token_use (
    jti_hash BYTEA PRIMARY KEY,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "user".mfa_webauthn_challenges (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    data BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_mfa_webauthn_challenges_exp ON "user".mfa_webauthn_challenges (expires_at);

CREATE TABLE IF NOT EXISTS "user".mfa_audit_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    event_kind TEXT NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mfa_audit_user ON "user".mfa_audit_events (user_id, created_at DESC);

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS mfa_lockout_until TIMESTAMPTZ;

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS mfa_rate_failures INT NOT NULL DEFAULT 0;

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS mfa_rate_window_start TIMESTAMPTZ;

ALTER TABLE settings.platform_app_settings
    ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN;

ALTER TABLE settings.platform_app_settings
    ADD COLUMN IF NOT EXISTS mfa_enforcement TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_platform_mfa_enforcement'
    ) THEN
        ALTER TABLE settings.platform_app_settings
            ADD CONSTRAINT chk_platform_mfa_enforcement
            CHECK (mfa_enforcement IS NULL OR mfa_enforcement IN ('none', 'all', 'staff'));
    END IF;
END $$;
