-- Soft-delete for module child items (headings, pages, assignments, quizzes).
ALTER TABLE course.course_structure_items
    ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN course.course_structure_items.archived IS
    'When true, item is hidden from student view and excluded from student course structure.';
