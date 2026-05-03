-- Plan 5.1 — Root tenant entity: organizations + org_id on users and courses.

CREATE SCHEMA IF NOT EXISTS tenant;

CREATE TABLE tenant.organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deleted')),
    max_users       INTEGER,
    max_courses     INTEGER,
    data_region     TEXT NOT NULL DEFAULT 'us-east-1',
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_organizations_slug_lower ON tenant.organizations (LOWER(slug));

COMMENT ON TABLE tenant.organizations IS 'Top-level tenant boundary (plan 5.1).';

-- Well-known default org for single-tenant and backfill (stable UUID).
INSERT INTO tenant.organizations (id, slug, name, status)
VALUES (
    'a0000000-0000-4000-8000-0000000000a0'::uuid,
    'default',
    'Default organization',
    'active'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES tenant.organizations (id);

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES tenant.organizations (id);

CREATE INDEX IF NOT EXISTS idx_users_org_id ON "user".users (org_id);
CREATE INDEX IF NOT EXISTS idx_courses_org_id ON course.courses (org_id);

UPDATE "user".users
SET org_id = 'a0000000-0000-4000-8000-0000000000a0'::uuid
WHERE org_id IS NULL;

UPDATE course.courses
SET org_id = 'a0000000-0000-4000-8000-0000000000a0'::uuid
WHERE org_id IS NULL;

ALTER TABLE "user".users
    ALTER COLUMN org_id SET DEFAULT 'a0000000-0000-4000-8000-0000000000a0'::uuid;

ALTER TABLE course.courses
    ALTER COLUMN org_id SET DEFAULT 'a0000000-0000-4000-8000-0000000000a0'::uuid;

ALTER TABLE "user".users
    ALTER COLUMN org_id SET NOT NULL;

ALTER TABLE course.courses
    ALTER COLUMN org_id SET NOT NULL;

CREATE TABLE tenant.organization_audit_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    org_id      UUID NOT NULL REFERENCES tenant.organizations (id) ON DELETE CASCADE,
    action      TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_audit_org_created ON tenant.organization_audit_events (org_id, created_at DESC);

COMMENT ON TABLE tenant.organization_audit_events IS 'Super-admin org lifecycle audit (plan 5.1 FR-7).';
