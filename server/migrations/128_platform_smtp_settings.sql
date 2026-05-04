-- Outgoing SMTP overrides (Global platform). Password stored as AES-256-GCM ciphertext; see internal/crypto/appsecrets.
ALTER TABLE settings.platform_app_settings
    ADD COLUMN IF NOT EXISTS smtp_host TEXT,
    ADD COLUMN IF NOT EXISTS smtp_port INT,
    ADD COLUMN IF NOT EXISTS smtp_from TEXT,
    ADD COLUMN IF NOT EXISTS smtp_user TEXT,
    ADD COLUMN IF NOT EXISTS smtp_password_ciphertext BYTEA;

COMMENT ON COLUMN settings.platform_app_settings.smtp_password_ciphertext IS 'AES-256-GCM blob (version, nonce, tag); plaintext key in PLATFORM_SECRETS_KEY.';
