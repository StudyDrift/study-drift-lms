-- Course-wide grading scale and weighted assignment groups.

ALTER TABLE course.courses
    ADD COLUMN grading_scale TEXT NOT NULL DEFAULT 'letter_standard';

CREATE TABLE course.assignment_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    sort_order INT NOT NULL,
    name TEXT NOT NULL,
    weight_percent DOUBLE PRECISION NOT NULL CHECK (weight_percent >= 0::double precision AND weight_percent <= 100::double precision),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course_id, sort_order)
);

CREATE INDEX idx_assignment_groups_course_id ON course.assignment_groups (course_id);

ALTER TABLE course.course_structure_items
    ADD COLUMN assignment_group_id UUID REFERENCES course.assignment_groups (id) ON DELETE SET NULL;
