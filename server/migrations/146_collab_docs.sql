-- Plan 6.5: Collaborative Documents / Shared Whiteboard
-- Creates collab schema, collaborative_documents, collab_doc_snapshots, and collab_doc_updates tables.
-- Also adds collab_docs_enabled feature flag to course.courses.

CREATE SCHEMA IF NOT EXISTS collab;

ALTER TABLE course.courses ADD COLUMN IF NOT EXISTS collab_docs_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS collab.collaborative_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   UUID NOT NULL REFERENCES course.courses(id) ON DELETE CASCADE,
  group_id    UUID,
  title       TEXT NOT NULL,
  doc_type    TEXT NOT NULL DEFAULT 'rich_text'
                CHECK (doc_type IN ('rich_text','whiteboard')),
  ydoc_state  BYTEA,
  created_by  UUID NOT NULL REFERENCES "user".users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collab_docs_course ON collab.collaborative_documents(course_id);

CREATE TABLE IF NOT EXISTS collab.collab_doc_snapshots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id     UUID NOT NULL REFERENCES collab.collaborative_documents(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES "user".users(id),
  snapshot   BYTEA NOT NULL,
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_snapshots_doc ON collab.collab_doc_snapshots(doc_id, taken_at DESC);

-- Individual Y.js sync updates persisted for replay on new client connection.
CREATE TABLE IF NOT EXISTS collab.collab_doc_updates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id     UUID NOT NULL REFERENCES collab.collaborative_documents(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES "user".users(id),
  update     BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collab_updates_doc ON collab.collab_doc_updates(doc_id, created_at ASC);
