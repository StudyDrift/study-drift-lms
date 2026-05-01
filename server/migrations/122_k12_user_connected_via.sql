-- Plan 4.4 — K-12 SSO: connected_via on users (new version; do not alter 120 checksum after prod apply).

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS connected_via TEXT;

COMMENT ON COLUMN "user".users.connected_via IS 'K-12 middleware used for first provisioning: clever or classlink.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_connected_via_check'
    ) THEN
        ALTER TABLE "user".users
            ADD CONSTRAINT users_connected_via_check CHECK (
                connected_via IS NULL OR connected_via IN ('clever', 'classlink')
            ) NOT VALID;
        ALTER TABLE "user".users VALIDATE CONSTRAINT users_connected_via_check;
    END IF;
END $$;
