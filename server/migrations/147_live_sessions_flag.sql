-- Plan 6.4: Live Sessions feature flag
-- Adds live_sessions_enabled to course.courses so instructors can hide the
-- Live Sessions menu item and page. Defaults TRUE to preserve existing behavior
-- for all courses that were created before this flag existed.

ALTER TABLE course.courses ADD COLUMN IF NOT EXISTS live_sessions_enabled BOOLEAN NOT NULL DEFAULT TRUE;
