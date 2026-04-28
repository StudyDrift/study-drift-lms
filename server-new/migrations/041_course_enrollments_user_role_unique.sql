-- Allow the same user to hold multiple roles in one course (e.g. Teacher + Student preview).
-- Replaces UNIQUE (course_id, user_id) with UNIQUE (course_id, user_id, role).

ALTER TABLE course.course_enrollments
    DROP CONSTRAINT IF EXISTS course_enrollments_course_id_user_id_key;

ALTER TABLE course.course_enrollments
    ADD CONSTRAINT course_enrollments_course_user_role_unique UNIQUE (course_id, user_id, role);
