-- Official student identifier (SIS / campus ID). Set by administrators; not user-editable.
ALTER TABLE "user".users
    ADD COLUMN sid TEXT NULL;

CREATE UNIQUE INDEX users_sid_unique ON "user".users (sid)
    WHERE sid IS NOT NULL;

COMMENT ON COLUMN "user".users.sid IS 'Campus / SIS student identifier; unique when set; assigned by admins.';
