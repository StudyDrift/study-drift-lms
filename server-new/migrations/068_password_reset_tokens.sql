-- Self-service password recovery: opaque tokens (hashed at rest), single-use, time-limited.

CREATE TABLE IF NOT EXISTS "user".password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_token_hash_key ON "user".password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON "user".password_reset_tokens (user_id);
