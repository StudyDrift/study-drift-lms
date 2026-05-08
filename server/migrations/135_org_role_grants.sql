-- Plan 5.8 — Org-level role hierarchy: coarse org_admin / org_unit_admin / org_viewer grants (tenant.org_role_grants).

CREATE TABLE tenant.org_role_grants (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES tenant.organizations (id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    org_unit_id   UUID REFERENCES tenant.org_units (id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('org_admin', 'org_unit_admin', 'org_viewer')),
    granted_by    UUID NOT NULL REFERENCES "user".users (id) ON DELETE RESTRICT,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ,
    CONSTRAINT uq_org_role_grants UNIQUE NULLS NOT DISTINCT (org_id, user_id, role, org_unit_id)
);

CREATE INDEX idx_org_role_grants_org_user ON tenant.org_role_grants (org_id, user_id);
CREATE INDEX idx_org_role_grants_user ON tenant.org_role_grants (user_id, org_id);
CREATE INDEX idx_org_role_grants_expiry ON tenant.org_role_grants (expires_at)
    WHERE expires_at IS NOT NULL;

COMMENT ON TABLE tenant.org_role_grants IS 'Org-scoped administrative roles (plan 5.8); evaluated alongside course grants and global roles.';
