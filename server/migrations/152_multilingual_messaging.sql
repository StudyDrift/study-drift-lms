-- Plan 6.10: Multilingual / Translated Messaging
-- Adds per-course feature flag and a shared translation cache table.

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS multilingual_messaging_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN course.courses.multilingual_messaging_enabled IS
    'When true, users see a Translate button on feed posts, discussion posts, and inbox messages (plan 6.10).';

CREATE TABLE IF NOT EXISTS course.content_translations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type TEXT NOT NULL CHECK (content_type IN ('feed_post', 'discussion_post', 'inbox_message', 'announcement')),
    content_id   UUID NOT NULL,
    source_lang  TEXT NOT NULL,
    target_lang  TEXT NOT NULL,
    translated   TEXT NOT NULL,
    provider     TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (content_type, content_id, target_lang)
);

CREATE INDEX IF NOT EXISTS idx_translations_lookup
    ON course.content_translations (content_type, content_id, target_lang);
