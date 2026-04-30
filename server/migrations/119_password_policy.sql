-- Plan 4.10 — password policy, HIBP prefix cache, credential audit (signup / change / reset).

CREATE TABLE IF NOT EXISTS "user".password_policies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id  UUID,
    min_length      INT NOT NULL DEFAULT 8,
    require_upper   BOOLEAN NOT NULL DEFAULT FALSE,
    require_lower   BOOLEAN NOT NULL DEFAULT FALSE,
    require_digit   BOOLEAN NOT NULL DEFAULT FALSE,
    require_special BOOLEAN NOT NULL DEFAULT FALSE,
    check_hibp      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one global (institution-less) policy row.
CREATE UNIQUE INDEX IF NOT EXISTS password_policies_one_global
    ON "user".password_policies ((1))
    WHERE institution_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS password_policies_one_per_institution
    ON "user".password_policies (institution_id)
    WHERE institution_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS "user".hibp_prefix_cache (
    prefix      CHAR(5) PRIMARY KEY,
    suffixes    TEXT NOT NULL,
    cached_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "user".password_credential_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    event_kind       TEXT NOT NULL CHECK (event_kind IN ('signup', 'password_change', 'password_reset')),
    breach_found     BOOLEAN NOT NULL,
    hibp_available   BOOLEAN NOT NULL,
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_credential_events_user_occurred
    ON "user".password_credential_events (user_id, occurred_at DESC);

-- Default global policy: length ≥ 8, complexity off, HIBP on.
INSERT INTO "user".password_policies (
    institution_id, min_length, require_upper, require_lower, require_digit, require_special, check_hibp
)
SELECT NULL, 8, FALSE, FALSE, FALSE, FALSE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM "user".password_policies WHERE institution_id IS NULL);
