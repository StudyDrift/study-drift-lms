-- Plan 6.9: Conversational AI Tutor
-- Adds ai_tutor_enabled feature flag, tutor conversation history, and token budget tracking.

ALTER TABLE course.courses ADD COLUMN IF NOT EXISTS ai_tutor_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS course.tutor_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  course_id       UUID NOT NULL REFERENCES course.courses(id) ON DELETE CASCADE,
  messages        JSONB NOT NULL DEFAULT '[]',
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_tutor_conv_student ON course.tutor_conversations(student_id, course_id);

CREATE TABLE IF NOT EXISTS course.student_token_budgets (
  student_id    UUID NOT NULL REFERENCES "user".users(id) ON DELETE CASCADE,
  org_id        UUID NOT NULL REFERENCES tenant.organizations(id) ON DELETE CASCADE,
  period_month  DATE NOT NULL,
  tokens_used   INTEGER NOT NULL DEFAULT 0,
  token_limit   INTEGER NOT NULL DEFAULT 50000,
  PRIMARY KEY (student_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_token_budgets_org ON course.student_token_budgets(org_id, period_month);
