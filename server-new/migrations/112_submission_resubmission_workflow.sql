-- Plan 3.13 — resubmission workflow: version history + per-student revision state.

-- Historical submission files (append-only) before each resubmission; current state stays on module_assignment_submissions.
CREATE TABLE course.submission_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    module_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    attachment_file_id UUID REFERENCES course.course_files (id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT submission_versions_version_positive CHECK (version_number >= 1),
    CONSTRAINT submission_versions_unique_v UNIQUE (module_item_id, student_id, version_number)
);

CREATE INDEX idx_submission_versions_item_student
    ON course.submission_versions (module_item_id, student_id, version_number);

COMMENT ON TABLE course.submission_versions IS
    'Archived assignment submission file rows before each resubmission (plan 3.13).';

ALTER TABLE course.module_assignment_submissions
    ADD COLUMN resubmission_requested BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN revision_due_at TIMESTAMPTZ,
    ADD COLUMN revision_feedback TEXT,
    ADD COLUMN version_number INT NOT NULL DEFAULT 1,
    ADD CONSTRAINT module_assignment_submissions_version_positive CHECK (version_number >= 1);

-- Extend grade audit actions (3.10) for 3.13.
ALTER TABLE course.grade_audit_events
    DROP CONSTRAINT IF EXISTS grade_audit_events_action_check;

ALTER TABLE course.grade_audit_events
    ADD CONSTRAINT grade_audit_events_action_check CHECK (action IN
        (
            'created', 'updated', 'excused', 'unexcused', 'posted', 'retracted', 'deleted',
            'revision_requested', 'resubmission_received'
        ));
