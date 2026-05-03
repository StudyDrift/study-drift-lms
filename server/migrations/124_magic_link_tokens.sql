-- Plan 4.7 — Passwordless magic-link login: hashed tokens, single-use, 15-minute TTL.

CREATE TABLE IF NOT EXISTS "user".magic_link_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    token_hash   BYTEA NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ,
    redirect_to  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS magic_link_tokens_token_hash_key ON "user".magic_link_tokens (token_hash);
CREATE INDEX IF NOT EXISTS magic_link_tokens_user_created_idx ON "user".magic_link_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS magic_link_tokens_active_hash_idx ON "user".magic_link_tokens (token_hash)
    WHERE consumed_at IS NULL;

COMMENT ON TABLE "user".magic_link_tokens IS 'One-time email login tokens (plan 4.7); token_hash is SHA-256 of URL-safe token.';
