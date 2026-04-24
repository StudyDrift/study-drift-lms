-- Split from duplicate 033: module_quizzes + ui_theme both used version 33 (sqlx collision).
ALTER TABLE "user".users
    ADD COLUMN IF NOT EXISTS ui_theme TEXT NOT NULL DEFAULT 'light';

ALTER TABLE "user".users
    DROP CONSTRAINT IF EXISTS users_ui_theme_check;

ALTER TABLE "user".users
    ADD CONSTRAINT users_ui_theme_check CHECK (ui_theme IN ('light', 'dark'));

COMMENT ON COLUMN "user".users.ui_theme IS 'Persisted LMS UI theme: light or dark. Default light.';
