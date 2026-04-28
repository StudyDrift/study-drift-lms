-- New accounts default to the Teacher app role; grant platform course creation to match.

INSERT INTO "user".permissions (permission_string, description)
VALUES (
        'global:app:course:create',
        'Create new courses on the platform.'
    )
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id,
       p.id
FROM "user".app_roles r
JOIN "user".permissions p ON p.permission_string = 'global:app:course:create'
WHERE r.name = 'Teacher'
ON CONFLICT (role_id, permission_id) DO NOTHING;
