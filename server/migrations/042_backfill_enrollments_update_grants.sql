-- Let course staff manage roster rows (e.g. remove a duplicate student role) via enrollments:update.
INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
SELECT ce.user_id,
       c.id,
       'course:' || c.course_code || ':enrollments:update'
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE ce.role IN ('teacher', 'instructor')
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING;
