-- Plan 1.9: progressive hints, worked examples, hint request logging, course feature flag.

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS hint_scaffolding_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE course.question_hints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 5),
    body TEXT NOT NULL,
    media_url TEXT,
    locale TEXT NOT NULL DEFAULT 'en',
    penalty_pct NUMERIC(4, 1) NOT NULL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (question_id, level, locale)
);

CREATE INDEX idx_question_hints_question ON course.question_hints (question_id);

CREATE TABLE course.question_worked_examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    title TEXT,
    body TEXT,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (question_id)
);

CREATE TABLE course.hint_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES course.quiz_attempts (id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    hint_level SMALLINT NOT NULL CHECK (hint_level BETWEEN 1 AND 5),
    hint_type TEXT NOT NULL DEFAULT 'static' CHECK (hint_type IN ('static', 'ai')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hint_requests_attempt_q ON course.hint_requests (attempt_id, question_id);
CREATE INDEX idx_hint_requests_question_time ON course.hint_requests (question_id, requested_at DESC);

COMMENT ON TABLE course.question_hints IS 'Up to 5 ordered hint levels per bank question (plan 1.9).';
COMMENT ON TABLE course.question_worked_examples IS 'Optional step-by-step worked example per bank question (plan 1.9).';
COMMENT ON TABLE course.hint_requests IS 'Per-attempt hint reveal audit log (plan 1.9).';
COMMENT ON COLUMN course.courses.hint_scaffolding_enabled IS 'When true, quiz hint and worked-example APIs are active for this course.';
