-- Instructor-managed enrollment groups (separate from assignment grading groups).

ALTER TABLE course.courses
    ADD COLUMN enrollment_groups_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE course.enrollment_group_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enrollment_group_sets_course_id ON course.enrollment_group_sets (course_id);

CREATE TABLE course.enrollment_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_set_id UUID NOT NULL REFERENCES course.enrollment_group_sets (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enrollment_groups_group_set_id ON course.enrollment_groups (group_set_id);

CREATE TABLE course.enrollment_group_memberships (
    enrollment_id UUID NOT NULL REFERENCES course.course_enrollments (id) ON DELETE CASCADE,
    group_set_id UUID NOT NULL REFERENCES course.enrollment_group_sets (id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES course.enrollment_groups (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (enrollment_id, group_set_id)
);

CREATE INDEX idx_enrollment_group_memberships_group_id ON course.enrollment_group_memberships (group_id);
