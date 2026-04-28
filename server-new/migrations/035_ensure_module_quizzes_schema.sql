-- Repair drift: migration 033 once shared version 33 with ui_theme (see 034_ui_theme.sql).
-- A database can list version 034 applied while `module_quizzes` / `quiz` kind never landed.
-- This idempotently matches the DDL from 033_module_quizzes.sql.

CREATE TABLE IF NOT EXISTS course.module_quizzes (
    structure_item_id UUID PRIMARY KEY REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    markdown TEXT NOT NULL DEFAULT '',
    questions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE course.course_structure_items DROP CONSTRAINT IF EXISTS course_structure_items_kind_check;
ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_kind_check
    CHECK (kind IN ('module', 'heading', 'content_page', 'assignment', 'quiz'));

ALTER TABLE course.course_structure_items DROP CONSTRAINT IF EXISTS course_structure_items_parent_child_kind_check;
ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_parent_child_kind_check
    CHECK (parent_id IS NULL OR kind IN ('heading', 'content_page', 'assignment', 'quiz'));

INSERT INTO course.module_quizzes (structure_item_id, markdown, questions_json)
SELECT c.id, '', '[]'::jsonb
FROM course.course_structure_items c
WHERE c.kind = 'quiz'
  AND NOT EXISTS (
      SELECT 1 FROM course.module_quizzes m WHERE m.structure_item_id = c.id
  );
