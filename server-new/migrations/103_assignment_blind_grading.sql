-- Plan 3.3 — anonymous / blind grading (per-assignment toggle + reveal audit).

ALTER TABLE course.module_assignments
    ADD COLUMN IF NOT EXISTS blind_grading BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS identities_revealed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN course.module_assignments.blind_grading IS
    'When true, graders see anonymised labels until identities_revealed_at is set.';
COMMENT ON COLUMN course.module_assignments.identities_revealed_at IS
    'Set when the instructor reveals student identities for this assignment.';

CREATE TABLE course.assignment_blind_grading_reveal_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    structure_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    revealed_by_user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    revealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignment_blind_reveal_audit_item
    ON course.assignment_blind_grading_reveal_audit (structure_item_id, revealed_at DESC);
