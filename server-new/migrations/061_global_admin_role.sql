-- System settings (roles/permissions, AI model defaults, system prompts) use `global:app:rbac:manage`.
-- Baseline Teacher/TA roles should not grant that permission; only the Global Admin role does.

INSERT INTO "user".app_roles (name, description, scope)
VALUES (
    'Global Admin',
    'Platform administration: system settings, roles and permissions, and AI configuration.',
    'global'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM "user".app_roles r
JOIN "user".permissions p ON p.permission_string = 'global:app:rbac:manage'
WHERE r.name = 'Global Admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM "user".rbac_role_permissions rp
USING "user".app_roles r,
    "user".permissions p
WHERE rp.role_id = r.id
    AND rp.permission_id = p.id
    AND r.name IN ('Teacher', 'TA')
    AND p.permission_string = 'global:app:rbac:manage';

-- Users who already hold Teacher or TA globally keep system access via Global Admin.
INSERT INTO "user".user_app_roles (user_id, role_id)
SELECT DISTINCT uar.user_id, ga.id
FROM "user".user_app_roles uar
JOIN "user".app_roles ar ON ar.id = uar.role_id AND ar.name IN ('Teacher', 'TA')
CROSS JOIN "user".app_roles ga
WHERE ga.name = 'Global Admin'
ON CONFLICT (user_id, role_id) DO NOTHING;
