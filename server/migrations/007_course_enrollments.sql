-- Per-course membership and roles. Creator is stored on the course and mirrored as an owner enrollment.

CREATE TABLE course_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'instructor', 'student')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course_id, user_id)
);

CREATE INDEX idx_course_enrollments_course_id ON course_enrollments (course_id);
CREATE INDEX idx_course_enrollments_user_id ON course_enrollments (user_id);

ALTER TABLE courses ADD COLUMN created_by_user_id UUID REFERENCES users (id) ON DELETE SET NULL;

-- Existing deployments: attach orphan courses to the earliest user as owner so the catalog keeps working.
INSERT INTO course_enrollments (course_id, user_id, role)
SELECT c.id, u.id, 'owner'
FROM courses c
CROSS JOIN LATERAL (
    SELECT id FROM users ORDER BY created_at ASC LIMIT 1
) u
WHERE NOT EXISTS (
    SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id
);

UPDATE courses c
SET created_by_user_id = e.user_id
FROM course_enrollments e
WHERE e.course_id = c.id
  AND e.role = 'owner'
  AND c.created_by_user_id IS NULL;
