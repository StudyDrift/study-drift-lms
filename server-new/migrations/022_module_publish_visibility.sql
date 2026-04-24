-- Module visibility to students: draft vs published, and optional scheduled release.
ALTER TABLE course.course_structure_items
    ADD COLUMN published BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN visible_from TIMESTAMPTZ NULL;

COMMENT ON COLUMN course.course_structure_items.published IS
    'When false, module (and its items) are hidden from students. Staff still see full structure.';
COMMENT ON COLUMN course.course_structure_items.visible_from IS
    'If set, students only see the module on or after this instant (UTC). Null means no schedule.';
