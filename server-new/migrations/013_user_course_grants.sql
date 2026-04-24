-- Per-course permission grants (e.g. course:C-ABC123:module:create for a course Teacher).
-- These are merged with global role permissions when evaluating authorization.

CREATE TABLE course.user_course_grants (
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    permission_string TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, course_id, permission_string)
);

CREATE INDEX idx_user_course_grants_user_id ON course.user_course_grants (user_id);
CREATE INDEX idx_user_course_grants_course_id ON course.user_course_grants (course_id);

-- Owners can create modules in their courses (same permission shape as course Teachers).
INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
SELECT ce.user_id,
       c.id,
       'course:' || c.course_code || ':module:create'
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE ce.role = 'owner'
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING;
