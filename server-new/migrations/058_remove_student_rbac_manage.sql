-- The baseline Student app role should not manage platform roles and permissions.
DELETE FROM "user".rbac_role_permissions rp
USING "user".app_roles r,
    "user".permissions p
WHERE rp.role_id = r.id
    AND rp.permission_id = p.id
    AND r.name = 'Student'
    AND p.permission_string = 'global:app:rbac:manage';
