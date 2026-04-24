-- Database schema hardening: JSON settings versioning, lookup indexes, partial indexes, explicit FK ON DELETE.

-- ---------------------------------------------------------------------------
-- settings_version: monotonic guard before breaking JSON shape changes
-- ---------------------------------------------------------------------------
ALTER TABLE course.module_quizzes
    ADD COLUMN IF NOT EXISTS settings_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN course.module_quizzes.settings_version IS
    'Increments when questions_json or adaptive JSON payloads change shape meaningfully.';

ALTER TABLE course.module_assignments
    ADD COLUMN IF NOT EXISTS settings_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN course.module_assignments.settings_version IS
    'Increments when rubric_json or assignment delivery JSON shape changes.';

ALTER TABLE course.course_syllabus
    ADD COLUMN IF NOT EXISTS settings_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN course.course_syllabus.settings_version IS
    'Increments when sections JSON shape changes.';

ALTER TABLE course.module_surveys
    ADD COLUMN IF NOT EXISTS settings_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN course.module_surveys.settings_version IS
    'Increments when questions_json shape changes.';

ALTER TABLE course.course_grades
    ADD COLUMN IF NOT EXISTS settings_version INT NOT NULL DEFAULT 1;

COMMENT ON COLUMN course.course_grades.settings_version IS
    'Increments when rubric_scores_json shape or semantics change.';

-- ---------------------------------------------------------------------------
-- Composite indexes for common join / filter paths
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course_user
    ON course.course_enrollments (course_id, user_id);

CREATE INDEX IF NOT EXISTS idx_course_grades_course_student_item
    ON course.course_grades (course_id, student_user_id, module_item_id);

-- ---------------------------------------------------------------------------
-- Partial indexes for hot boolean / visibility filters
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_courses_unarchived_by_created
    ON course.courses (created_at DESC)
    WHERE archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_courses_published_not_hidden
    ON course.courses (published)
    WHERE archived = FALSE
      AND hidden_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_course_structure_items_visible
    ON course.course_structure_items (course_id, sort_order)
    WHERE archived = FALSE
      AND published = TRUE;

-- ---------------------------------------------------------------------------
-- Foreign keys: explicit ON DELETE (previous implicit NO ACTION)
-- ---------------------------------------------------------------------------
ALTER TABLE course.question_versions
    DROP CONSTRAINT IF EXISTS question_versions_created_by_fkey;

ALTER TABLE course.question_versions
    ADD CONSTRAINT question_versions_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES "user".users (id) ON DELETE SET NULL;

ALTER TABLE course.enrollment_quiz_overrides
    DROP CONSTRAINT IF EXISTS enrollment_quiz_overrides_created_by_fkey;

ALTER TABLE course.enrollment_quiz_overrides
    ADD CONSTRAINT enrollment_quiz_overrides_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES "user".users (id) ON DELETE RESTRICT;

ALTER TABLE course.module_survey_responses
    DROP CONSTRAINT IF EXISTS module_survey_responses_user_id_fkey;

ALTER TABLE course.module_survey_responses
    ADD CONSTRAINT module_survey_responses_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES "user".users (id) ON DELETE SET NULL;

ALTER TABLE course.questions
    DROP CONSTRAINT IF EXISTS questions_created_by_fkey;

ALTER TABLE course.questions
    ADD CONSTRAINT questions_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES "user".users (id) ON DELETE SET NULL;

ALTER TABLE course.student_accommodations
    DROP CONSTRAINT IF EXISTS student_accommodations_created_by_fkey;

ALTER TABLE course.student_accommodations
    ADD CONSTRAINT student_accommodations_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES "user".users (id) ON DELETE RESTRICT;

ALTER TABLE course.student_accommodations
    DROP CONSTRAINT IF EXISTS student_accommodations_updated_by_fkey;

ALTER TABLE course.student_accommodations
    ADD CONSTRAINT student_accommodations_updated_by_fkey
        FOREIGN KEY (updated_by) REFERENCES "user".users (id) ON DELETE SET NULL;
