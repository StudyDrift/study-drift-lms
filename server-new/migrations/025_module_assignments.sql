-- Markdown bodies for structure items of kind `assignment` under modules.
CREATE TABLE course.module_assignments (
    structure_item_id UUID PRIMARY KEY REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    markdown TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Existing assignment rows (if any) need a body row.
INSERT INTO course.module_assignments (structure_item_id, markdown)
SELECT c.id, ''
FROM course.course_structure_items c
WHERE c.kind = 'assignment'
  AND NOT EXISTS (
      SELECT 1 FROM course.module_assignments m WHERE m.structure_item_id = c.id
  );
