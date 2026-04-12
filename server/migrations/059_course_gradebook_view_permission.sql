-- View course grading settings (GET /grading). Concrete grants are per course; catalog uses placeholder.

INSERT INTO "user".permissions (permission_string, description)
VALUES (
        'course:<courseCode>:gradebook:view',
        'View course grading settings (scale and weighted assignment groups).'
    )
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
SELECT r.id,
       p.id
FROM "user".app_roles r
INNER JOIN "user".permissions p ON p.permission_string = 'course:<courseCode>:gradebook:view'
WHERE r.name IN ('Teacher', 'TA')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
SELECT ce.user_id,
       c.id,
       'course:' || c.course_code || ':gradebook:view'
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE ce.role IN ('teacher', 'instructor')
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING;
