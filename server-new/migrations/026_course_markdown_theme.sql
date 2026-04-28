-- How Markdown is styled for syllabus, content pages, and assignments.
ALTER TABLE course.courses
    ADD COLUMN markdown_theme_preset TEXT NOT NULL DEFAULT 'classic',
    ADD COLUMN markdown_theme_custom JSONB;

ALTER TABLE course.courses
    ADD CONSTRAINT courses_markdown_theme_preset_check
        CHECK (
            markdown_theme_preset IN (
                'classic',
                'reader',
                'serif',
                'contrast',
                'night',
                'accent',
                'custom'
            )
        );

COMMENT ON COLUMN course.courses.markdown_theme_preset IS
    'Preset id for Markdown reading theme, or ''custom'' when markdown_theme_custom is used.';
COMMENT ON COLUMN course.courses.markdown_theme_custom IS
    'Optional overrides when preset is custom (colors, width, font).';
