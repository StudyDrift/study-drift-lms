-- Placeholder catalog entries so view-as-student can tell staff-only roster grants from Student grants
-- (concrete `user_course_grants` are matched after expanding `course:<courseCode>:…`).

INSERT INTO "user".permissions (permission_string, description)
VALUES (
        'course:<courseCode>:enrollments:update',
        'Manage the course roster (add/remove roles) when granted per course.'
    )
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id,
       p.id
FROM "user".app_roles r
INNER JOIN "user".permissions p ON p.permission_string = 'course:<courseCode>:enrollments:read'
WHERE r.name IN ('Teacher', 'TA')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id,
       p.id
FROM "user".app_roles r
INNER JOIN "user".permissions p ON p.permission_string = 'course:<courseCode>:enrollments:update'
WHERE r.name IN ('Teacher', 'TA')
ON CONFLICT (role_id, permission_id) DO NOTHING;
