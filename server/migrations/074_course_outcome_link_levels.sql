-- Per-link measurement and intensity so the same assignment or quiz question can map to one outcome
-- multiple times (different pedagogical roles) and the same item can map to many outcomes.
-- Idempotent: safe if an older duplicate `073_*` migration already added these columns.

ALTER TABLE course.course_outcome_links
    ADD COLUMN IF NOT EXISTS measurement_level TEXT NOT NULL DEFAULT 'formative',
    ADD COLUMN IF NOT EXISTS intensity_level TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE course.course_outcome_links DROP CONSTRAINT IF EXISTS course_outcome_links_measurement_level_check;
ALTER TABLE course.course_outcome_links
    ADD CONSTRAINT course_outcome_links_measurement_level_check CHECK (
        measurement_level IN ('diagnostic', 'formative', 'summative', 'performance')
    );

ALTER TABLE course.course_outcome_links DROP CONSTRAINT IF EXISTS course_outcome_links_intensity_level_check;
ALTER TABLE course.course_outcome_links
    ADD CONSTRAINT course_outcome_links_intensity_level_check CHECK (
        intensity_level IN ('low', 'medium', 'high')
    );

DROP INDEX IF EXISTS course.ux_course_outcome_links_unique_target;

CREATE UNIQUE INDEX ux_course_outcome_links_unique_target
    ON course.course_outcome_links (
        outcome_id,
        structure_item_id,
        target_kind,
        quiz_question_id,
        measurement_level,
        intensity_level
    );

COMMENT ON COLUMN course.course_outcome_links.measurement_level IS
    'How this item measures the outcome for this mapping (e.g. formative vs summative).';
COMMENT ON COLUMN course.course_outcome_links.intensity_level IS
    'Relative weight or depth of this mapping (low / medium / high).';
