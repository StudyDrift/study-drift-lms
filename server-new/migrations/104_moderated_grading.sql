-- Plan 3.4 — moderated grading: provisional scores, moderator reconciliation, grade audit.

ALTER TABLE course.module_assignments
    ADD COLUMN IF NOT EXISTS moderated_grading BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS moderation_threshold_pct INT NOT NULL DEFAULT 15
        CHECK (moderation_threshold_pct >= 0 AND moderation_threshold_pct <= 100),
    ADD COLUMN IF NOT EXISTS moderator_user_id UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS provisional_grader_user_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN course.module_assignments.moderated_grading IS
    'When true, final gradebook scores for this assignment are reconciled by the moderator after provisional grader scores.';
COMMENT ON COLUMN course.module_assignments.moderation_threshold_pct IS
    'Percent of assignment points; grader scores differing by more than this require moderator reconciliation.';

CREATE TABLE IF NOT EXISTS course.provisional_grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES course.module_assignment_submissions (id) ON DELETE CASCADE,
    grader_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    score DOUBLE PRECISION NOT NULL CHECK (
        score >= 0::double precision
        AND score <= 1e9::double precision
    ),
    rubric_data JSONB,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (submission_id, grader_id)
);

CREATE INDEX IF NOT EXISTS idx_provisional_grades_submission
    ON course.provisional_grades (submission_id);
CREATE INDEX IF NOT EXISTS idx_provisional_grades_grader
    ON course.provisional_grades (grader_id);

COMMENT ON TABLE course.provisional_grades IS
    'Per-grader provisional scores before moderator reconciliation (plan 3.4).';

ALTER TABLE course.course_grades
    ADD COLUMN IF NOT EXISTS reconciliation_source TEXT
        CHECK (
            reconciliation_source IS NULL
            OR reconciliation_source IN ('grader', 'average', 'override', 'single')
        ),
    ADD COLUMN IF NOT EXISTS reconciled_grader_id UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

COMMENT ON COLUMN course.course_grades.reconciliation_source IS
    'How the visible grade was chosen when moderated grading is used; NULL when not reconciled via moderator flow.';

CREATE TABLE IF NOT EXISTS course.grade_change_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    module_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    student_user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grade_change_audit_course_item_time
    ON course.grade_change_audit (course_id, module_item_id, created_at DESC);

COMMENT ON TABLE course.grade_change_audit IS
    'Append-only grade and reconciliation events (FERPA; plan 3.4 / 3.10).';
