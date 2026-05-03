-- Plan 4.8 — Short-lived access JWT + opaque refresh tokens (hashed at rest).

CREATE TABLE IF NOT EXISTS "user".refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    token_hash   BYTEA NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent   TEXT,
    ip_address   INET
);

CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_token_hash_key ON "user".refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_active_hash_idx ON "user".refresh_tokens (token_hash)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS refresh_tokens_user_active_idx ON "user".refresh_tokens (user_id, created_at DESC)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE "user".refresh_tokens IS 'Opaque refresh tokens (plan 4.8); token_hash is SHA-256 of raw token.';

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS token_invalidated_at TIMESTAMPTZ;

COMMENT ON COLUMN "user".users.token_invalidated_at IS 'JWTs with iat strictly before this instant are rejected (password change, etc.).';
