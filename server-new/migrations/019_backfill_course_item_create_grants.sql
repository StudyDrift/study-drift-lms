-- Course creators are enrolled as `teacher` (016); 013 only seeded grants for `owner` enrollments.
-- Ensure every course creator has `course:<code>:item:create` so syllabus/modules editing works.
INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
SELECT c.created_by_user_id,
       c.id,
       'course:' || c.course_code || ':item:create'
FROM course.courses c
WHERE c.created_by_user_id IS NOT NULL
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING;
