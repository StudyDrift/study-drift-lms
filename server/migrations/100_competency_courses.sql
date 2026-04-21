-- Competency-based course mode, sub-outcomes, and module anchors on learning outcomes.

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS course_type TEXT NOT NULL DEFAULT 'traditional';

ALTER TABLE course.courses DROP CONSTRAINT IF EXISTS courses_course_type_check;
ALTER TABLE course.courses
    ADD CONSTRAINT courses_course_type_check CHECK (course_type IN ('traditional', 'competency_based'));

ALTER TABLE course.course_learning_outcomes
    ADD COLUMN IF NOT EXISTS module_structure_item_id UUID REFERENCES course.course_structure_items (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS course.course_outcome_sub_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outcome_id UUID NOT NULL REFERENCES course.course_learning_outcomes (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_outcome_sub_outcomes_outcome_sort
    ON course.course_outcome_sub_outcomes (outcome_id, sort_order);

ALTER TABLE course.course_outcome_links
    ADD COLUMN IF NOT EXISTS sub_outcome_id UUID REFERENCES course.course_outcome_sub_outcomes (id) ON DELETE CASCADE;

DROP INDEX IF EXISTS course.ux_course_outcome_links_unique_target;

CREATE UNIQUE INDEX IF NOT EXISTS ux_course_outcome_links_unique_root
    ON course.course_outcome_links (
        outcome_id,
        structure_item_id,
        target_kind,
        quiz_question_id,
        measurement_level,
        intensity_level
    )
    WHERE sub_outcome_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_course_outcome_links_unique_sub
    ON course.course_outcome_links (
        outcome_id,
        sub_outcome_id,
        structure_item_id,
        target_kind,
        quiz_question_id,
        measurement_level,
        intensity_level
    )
    WHERE sub_outcome_id IS NOT NULL;

COMMENT ON COLUMN course.courses.course_type IS
    'traditional: standard module visibility; competency_based: sequential modules gated by prior outcome assessments.';
COMMENT ON TABLE course.course_outcome_sub_outcomes IS
    'Sub-outcomes nested under a course learning outcome (competency decomposition).';
COMMENT ON COLUMN course.course_outcome_links.sub_outcome_id IS
    'When set, the evidence link applies to this sub-outcome; when null, the link applies to the whole outcome.';
COMMENT ON COLUMN course.course_learning_outcomes.module_structure_item_id IS
    'Optional anchor module for this outcome/competency (used for competency-based gating order).';
