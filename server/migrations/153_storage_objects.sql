-- Storage schema for object-storage backend (plan 8.1)
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE storage.objects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  course_id     UUID REFERENCES course.courses(id) ON DELETE SET NULL,
  object_key    TEXT NOT NULL UNIQUE,
  bucket        TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  uploaded_by   UUID REFERENCES user_account(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX ON storage.objects (course_id);
CREATE INDEX ON storage.objects (tenant_id, deleted_at);
