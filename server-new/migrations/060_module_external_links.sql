-- External URL module items (Canvas-style): open a configured link in a new browser tab.
CREATE TABLE course.module_external_links (
    structure_item_id UUID PRIMARY KEY REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    url TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE course.course_structure_items DROP CONSTRAINT IF EXISTS course_structure_items_kind_check;
ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_kind_check
    CHECK (kind IN ('module', 'heading', 'content_page', 'assignment', 'quiz', 'external_link'));

ALTER TABLE course.course_structure_items DROP CONSTRAINT IF EXISTS course_structure_items_parent_child_kind_check;
ALTER TABLE course.course_structure_items
    ADD CONSTRAINT course_structure_items_parent_child_kind_check
    CHECK (parent_id IS NULL OR kind IN ('heading', 'content_page', 'assignment', 'quiz', 'external_link'));
