-- Per-course toggles for LMS tools (Notebook, Feed, Calendar).
ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS notebook_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS feed_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS calendar_enabled boolean NOT NULL DEFAULT true;
