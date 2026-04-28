-- Plan 3.8 — per-assignment grade posting: hold (manual) vs release as entered (automatic), scheduled post.

ALTER TABLE course.module_assignments
    ADD COLUMN IF NOT EXISTS posting_policy TEXT NOT NULL DEFAULT 'automatic'
        CHECK (posting_policy IN ('automatic', 'manual')),
    ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ;

COMMENT ON COLUMN course.module_assignments.posting_policy IS
    'automatic: grades visible to students as entered. manual: held until posted by instructor or schedule.';
COMMENT ON COLUMN course.module_assignments.release_at IS
    'When set in manual mode, a background job posts all held grades at or after this time (3.8).';

ALTER TABLE course.course_grades
    ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

COMMENT ON COLUMN course.course_grades.posted_at IS
    'For manual posting_policy rows: NULL = held from students; set when posted. Ignored for automatic.';

-- Existing grades were effectively visible; align with their last update.
UPDATE course.course_grades
SET posted_at = updated_at
WHERE posted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_course_grades_unposted
    ON course.course_grades (course_id, module_item_id)
    WHERE posted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_module_assignments_release_due
    ON course.module_assignments (release_at)
    WHERE release_at IS NOT NULL;
