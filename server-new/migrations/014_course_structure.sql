-- Ordered course outline (modules, headings, etc.) in the course schema.
CREATE TABLE course.course_structure_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    sort_order INT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('module', 'heading')),
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course_id, sort_order)
);

CREATE INDEX idx_course_structure_items_course_id ON course.course_structure_items (course_id);
