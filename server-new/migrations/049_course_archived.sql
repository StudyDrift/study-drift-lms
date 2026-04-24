ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN course.courses.archived IS
    'When true, the course is hidden from enrolled-course lists and search; staff may still open it by URL.';
