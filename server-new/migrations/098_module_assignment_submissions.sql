-- Student file/text submissions for module assignments (SpeedGrader / annotation substrate).

CREATE TABLE IF NOT EXISTS course.module_assignment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    module_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    submitted_by UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    attachment_file_id UUID REFERENCES course.course_files (id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT module_assignment_submissions_unique_student UNIQUE (module_item_id, submitted_by)
);

CREATE INDEX IF NOT EXISTS idx_module_assignment_submissions_course_item
    ON course.module_assignment_submissions (course_id, module_item_id, submitted_at DESC);

COMMENT ON TABLE course.module_assignment_submissions IS
    'Per-student submission rows for module assignments; attachment_file_id points at course.course_files (PDF/images).';
