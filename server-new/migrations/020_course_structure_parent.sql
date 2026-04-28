-- Nest headings under modules via optional parent (module row id).
ALTER TABLE course.course_structure_items
    ADD COLUMN parent_id UUID REFERENCES course.course_structure_items (id) ON DELETE CASCADE;

ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_heading_parent_check
    CHECK (parent_id IS NULL OR kind = 'heading');

ALTER TABLE course.course_structure_items
    DROP CONSTRAINT IF EXISTS course_structure_items_course_id_sort_order_key;

CREATE UNIQUE INDEX idx_course_structure_items_top_level_order
    ON course.course_structure_items (course_id, sort_order)
    WHERE parent_id IS NULL;

CREATE UNIQUE INDEX idx_course_structure_items_child_order
    ON course.course_structure_items (parent_id, sort_order)
    WHERE parent_id IS NOT NULL;
