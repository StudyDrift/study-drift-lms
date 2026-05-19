-- Plan 6.6: Group Spaces
-- Adds group_spaces_enabled feature flag to course.courses and a group_id FK on
-- feed_channels so that groups can own private feed channels.
-- Channels with group_id IS NULL remain course-level (backward compatible).

ALTER TABLE course.courses ADD COLUMN IF NOT EXISTS group_spaces_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE course.feed_channels ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES course.enrollment_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_feed_channels_group ON course.feed_channels(group_id);
