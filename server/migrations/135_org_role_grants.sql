-- Plan 5.8 — Org-level role hierarchy (org_admin, org_unit_admin, org_viewer).

CREATE TABLE IF NOT EXISTS "user".org_role_grants (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES tenant.organizations (id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    org_unit_id  UUID REFERENCES tenant.org_units (id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('org_admin','org_unit_admin','org_viewer')),
    granted_by   UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,
    UNIQUE (org_id, user_id, role, org_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_org_role_grants_user_org
    ON "user".org_role_grants (user_id, org_id);

CREATE INDEX IF NOT EXISTS idx_org_role_grants_expiry
    ON "user".org_role_grants (expires_at)
    WHERE expires_at IS NOT NULL;

-- Permission strings exposed via /me/permissions; org scope is enforced server-side.
INSERT INTO "user".permissions (permission_string, description)
VALUES (
    'tenant:org:roles:manage',
    'Manage org-level role grants (org admin).'
)
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO "user".permissions (permission_string, description)
VALUES (
    'tenant:org:roles:view',
    'View org-level role grants (org viewer).'
)
ON CONFLICT (permission_string) DO NOTHING;

