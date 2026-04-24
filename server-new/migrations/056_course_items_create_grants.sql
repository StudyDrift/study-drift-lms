-- Quiz question-bank editor (`course:<code>:items:create`) alongside structure `item:create` grants.
INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
SELECT user_id,
       course_id,
       REPLACE(permission_string, ':item:create', ':items:create')
FROM course.user_course_grants
WHERE permission_string LIKE 'course:%:item:create'
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING;
