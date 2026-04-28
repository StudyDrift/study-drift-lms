-- Non-graded course surveys attached to module structure items.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'course' AND t.typname = 'survey_anonymity'
    ) THEN
        CREATE TYPE course.survey_anonymity AS ENUM ('identified', 'anonymous', 'pseudo_anonymous');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS course.module_surveys (
    structure_item_id UUID PRIMARY KEY REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    anonymity_mode course.survey_anonymity NOT NULL DEFAULT 'identified',
    opens_at TIMESTAMPTZ NULL,
    closes_at TIMESTAMPTZ NULL,
    questions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT module_surveys_window_check CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at <= closes_at)
);

CREATE TABLE IF NOT EXISTS course.module_survey_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    structure_item_id UUID NOT NULL REFERENCES course.module_surveys (structure_item_id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES "user".users (id),
    submission_hash TEXT NOT NULL,
    answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (structure_item_id, submission_hash)
);

CREATE INDEX IF NOT EXISTS idx_module_survey_responses_item
    ON course.module_survey_responses (structure_item_id);

ALTER TABLE course.course_structure_items DROP CONSTRAINT IF EXISTS course_structure_items_kind_check;
ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_kind_check
    CHECK (kind IN ('module', 'heading', 'content_page', 'assignment', 'quiz', 'external_link', 'survey'));

ALTER TABLE course.course_structure_items DROP CONSTRAINT IF EXISTS course_structure_items_parent_child_kind_check;
ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_parent_child_kind_check
    CHECK (parent_id IS NULL OR kind IN ('heading', 'content_page', 'assignment', 'quiz', 'external_link', 'survey'));

INSERT INTO course.module_surveys (structure_item_id, description, questions_json)
SELECT c.id, '', '[]'::jsonb
FROM course.course_structure_items c
WHERE c.kind = 'survey'
  AND NOT EXISTS (
      SELECT 1 FROM course.module_surveys s WHERE s.structure_item_id = c.id
  );
