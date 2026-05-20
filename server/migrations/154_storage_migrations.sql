-- Migration log for local-disk to object-storage migration (plan 8.1)
CREATE TABLE storage.migrations (
  id            SERIAL PRIMARY KEY,
  local_path    TEXT NOT NULL,
  object_key    TEXT NOT NULL,
  migrated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
