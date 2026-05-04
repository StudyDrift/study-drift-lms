-- Plan 5.2 — Sub-accounts: org_units hierarchy, course assignment, unit-scoped admin role.

CREATE TABLE tenant.org_units (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID NOT NULL REFERENCES tenant.organizations (id) ON DELETE CASCADE,
    parent_unit_id   UUID REFERENCES tenant.org_units (id) ON DELETE RESTRICT,
    name             TEXT NOT NULL,
    unit_type        TEXT NOT NULL DEFAULT 'other'
        CHECK (unit_type IN ('district', 'school', 'college', 'department', 'other')),
    status           TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_units_org_id ON tenant.org_units (org_id);
CREATE INDEX idx_org_units_parent ON tenant.org_units (parent_unit_id);

COMMENT ON TABLE tenant.org_units IS 'Nested org structure (schools, departments) within tenant.organizations (plan 5.2).';

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS org_unit_id UUID REFERENCES tenant.org_units (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_courses_org_unit_id ON course.courses (org_unit_id);

-- Scope an app role assignment to a unit subtree (principal, department chair).
-- Unit-scoped role assignments (same global role can apply to multiple units).
CREATE TABLE IF NOT EXISTS "user".user_org_unit_roles (
    user_id      UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    role_id      UUID NOT NULL REFERENCES "user".app_roles (id) ON DELETE CASCADE,
    org_unit_id  UUID NOT NULL REFERENCES tenant.org_units (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id, org_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_user_org_unit_roles_unit ON "user".user_org_unit_roles (org_unit_id);

INSERT INTO "user".permissions (permission_string, description)
VALUES (
    'tenant:org:units:admin',
    'Manage org units and see courses within assigned unit subtree.'
)
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO "user".app_roles (name, description, scope)
VALUES (
    'Org Unit Admin',
    'Administrative access limited to an organizational unit and its descendants.',
    'global'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM "user".app_roles r
JOIN "user".permissions p ON p.permission_string = 'tenant:org:units:admin'
WHERE r.name = 'Org Unit Admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
