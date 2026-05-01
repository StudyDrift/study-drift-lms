-- Plan 4.4 — Clever / ClassLink K-12 SSO (OIDC Instant Login, JIT provisioning fields).

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS clever_id TEXT,
    ADD COLUMN IF NOT EXISTS classlink_id TEXT,
    ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS connected_via TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_clever_id_unique'
    ) THEN
        ALTER TABLE "user".users ADD CONSTRAINT users_clever_id_unique UNIQUE (clever_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_classlink_id_unique'
    ) THEN
        ALTER TABLE "user".users ADD CONSTRAINT users_classlink_id_unique UNIQUE (classlink_id);
    END IF;
END $$;

ALTER TABLE "user".users
    ADD CONSTRAINT users_connected_via_check CHECK (
        connected_via IS NULL OR connected_via IN ('clever', 'classlink')
    ) NOT VALID;

ALTER TABLE "user".users VALIDATE CONSTRAINT users_connected_via_check;

COMMENT ON COLUMN "user".users.clever_id IS 'Clever user id from OIDC / profile; unique when set (plan 4.4).';
COMMENT ON COLUMN "user".users.classlink_id IS 'ClassLink sourced id or stable id from claims when set (plan 4.4).';
COMMENT ON COLUMN "user".users.connected_via IS 'K-12 middleware used for first provisioning: clever or classlink.';

ALTER TABLE settings.user_oidc_identities DROP CONSTRAINT IF EXISTS user_oidc_identities_provider_check;

ALTER TABLE settings.user_oidc_identities ADD CONSTRAINT user_oidc_identities_provider_check CHECK (
    provider IN ('google', 'microsoft', 'apple', 'custom', 'clever', 'classlink')
);
