-- 6.3 Push Notifications: VAPID push subscriptions, in-app notification inbox, push delivery jobs.

CREATE TABLE IF NOT EXISTS settings.push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  p256dh_key   TEXT NOT NULL,
  auth_secret  TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON settings.push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS settings.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  action_url TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON settings.notifications(user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS settings.push_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES settings.notifications(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  action_url      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'dead')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_jobs_pending
  ON settings.push_jobs (status, next_retry_at, created_at)
  WHERE status IN ('pending', 'failed');
