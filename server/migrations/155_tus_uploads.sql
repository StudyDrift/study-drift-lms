-- Resumable / chunked upload state table (plan 8.2).
-- storage schema already exists (migration 153).
CREATE TABLE storage.tus_uploads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  course_id       UUID REFERENCES course.courses(id) ON DELETE SET NULL,
  s3_upload_id    TEXT,
  object_key      TEXT NOT NULL,
  upload_length   BIGINT NOT NULL,
  upload_offset   BIGINT NOT NULL DEFAULT 0,
  mime_type       TEXT,
  filename        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON storage.tus_uploads (user_id, completed_at);
CREATE INDEX ON storage.tus_uploads (expires_at) WHERE completed_at IS NULL;
