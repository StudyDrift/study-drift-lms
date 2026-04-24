-- Optional due date/time for assignments (content pages appear on the course calendar when set).
ALTER TABLE course.course_structure_items
    ADD COLUMN due_at TIMESTAMPTZ;

COMMENT ON COLUMN course.course_structure_items.due_at IS
    'When the assignment is due (typically content_page items); drives the course calendar.';
