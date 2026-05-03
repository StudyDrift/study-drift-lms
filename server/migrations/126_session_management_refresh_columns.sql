-- Plan 4.9 — Session list metadata on refresh tokens.

ALTER TABLE "user".refresh_tokens
    ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS auth_method TEXT,
    ADD COLUMN IF NOT EXISTS location_city TEXT,
    ADD COLUMN IF NOT EXISTS location_country TEXT;

COMMENT ON COLUMN "user".refresh_tokens.last_refreshed_at IS 'Updated when this refresh token is used at /auth/refresh (plan 4.9).';
COMMENT ON COLUMN "user".refresh_tokens.auth_method IS 'password, saml, oidc, clever, magic_link, totp, webauthn, backup_code, scim (plan 4.9).';
