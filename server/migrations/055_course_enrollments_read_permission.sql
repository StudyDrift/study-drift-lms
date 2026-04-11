-- List course roster (GET enrollments): staff only; students do not receive this grant.
INSERT INTO "user".permissions (permission_string, description)
VALUES (
        'course:<courseCode>:enrollments:read',
        'View the course roster (names and enrollment roles).'
    )
ON CONFLICT (permission_string) DO NOTHING;

INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
SELECT ce.user_id,
       c.id,
       'course:' || c.course_code || ':enrollments:read'
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE ce.role IN ('teacher', 'instructor')
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING;
