-- 6.2 Email notifications: preferences, outbound jobs, daily digest queue.

CREATE TABLE IF NOT EXISTS settings.notification_preferences (
  user_id       UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  push_enabled  BOOLEAN NOT NULL DEFAULT true,
  digest_mode   TEXT NOT NULL DEFAULT 'instant'
    CHECK (digest_mode IN ('instant', 'daily', 'off')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_type)
);

CREATE TABLE IF NOT EXISTS settings.email_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  subject       TEXT NOT NULL,
  template      TEXT NOT NULL,
  template_vars JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_jobs_pending
  ON settings.email_jobs (status, next_retry_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS settings.email_digest_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  summary_line TEXT NOT NULL,
  detail_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_digest_items_user
  ON settings.email_digest_items (user_id, created_at);
