-- Course home / dashboard landing: data overview, calendar, or a specific content page.
ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS course_home_landing TEXT NOT NULL DEFAULT 'data'
        CHECK (course_home_landing IN ('data', 'calendar', 'content_page')),
    ADD COLUMN IF NOT EXISTS course_home_content_item_id UUID
        REFERENCES course.course_structure_items (id) ON DELETE SET NULL;

COMMENT ON COLUMN course.courses.course_home_landing IS
    'What learners and staff see at /courses/:code: data (overview), calendar, or content_page.';
COMMENT ON COLUMN course.courses.course_home_content_item_id IS
    'When course_home_landing is content_page, the module item (must be kind content_page).';
