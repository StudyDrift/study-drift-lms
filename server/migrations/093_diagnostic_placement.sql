-- Plan 1.7 — Diagnostic / placement assessments (course-level CAT + learner seeding).

CREATE TYPE course.diagnostic_stopping_rule AS ENUM ('max_items', 'se_threshold', 'both');

CREATE TABLE course.course_diagnostics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    concept_ids UUID[] NOT NULL,
    max_items INTEGER NOT NULL DEFAULT 20,
    stopping_rule course.diagnostic_stopping_rule NOT NULL DEFAULT 'both',
    se_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.3,
    retake_policy TEXT NOT NULL DEFAULT 'once'
        CHECK (retake_policy IN ('once', 'per_term', 'always')),
    placement_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    theta_cut_scores JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course_id)
);

CREATE INDEX idx_course_diagnostics_course ON course.course_diagnostics (course_id);

CREATE TABLE course.diagnostic_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagnostic_id UUID NOT NULL REFERENCES course.course_diagnostics (id) ON DELETE CASCADE,
    enrollment_id UUID NOT NULL REFERENCES course.course_enrollments (id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    bypassed BOOLEAN NOT NULL DEFAULT FALSE,
    placement_item_id UUID REFERENCES course.course_structure_items (id) ON DELETE SET NULL,
    theta_summary JSONB,
    placement_summary JSONB,
    responses JSONB NOT NULL DEFAULT '[]'::jsonb,
    session_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_diagnostic_attempts_enrollment ON course.diagnostic_attempts (enrollment_id, diagnostic_id, started_at DESC);

COMMENT ON TABLE course.course_diagnostics IS
    'Per-course placement assessment configuration (concepts probed, CAT limits, retake policy).';
COMMENT ON TABLE course.diagnostic_attempts IS
    'One learner session for a diagnostic; responses/session_state hold in-progress CAT state.';

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS diagnostic_assessments_enabled BOOLEAN NOT NULL DEFAULT FALSE;
