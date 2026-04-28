-- Spaced repetition / retrieval practice (plan 1.5): SM-2 scheduler, review queue, audit trail.

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS srs_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE course.questions
    ADD COLUMN IF NOT EXISTS srs_eligible BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TYPE course.srs_grade AS ENUM ('again', 'hard', 'good', 'easy');

CREATE TYPE course.srs_algorithm AS ENUM ('sm2', 'fsrs45');

CREATE TABLE course.srs_item_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    algorithm course.srs_algorithm NOT NULL DEFAULT 'sm2',
    interval_days NUMERIC(8, 2) NOT NULL DEFAULT 0,
    repetition INTEGER NOT NULL DEFAULT 0,
    easiness_factor NUMERIC(4, 3) NOT NULL DEFAULT 2.5,
    next_review_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_count INTEGER NOT NULL DEFAULT 0,
    suppressed_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, question_id)
);

CREATE INDEX idx_srs_queue ON course.srs_item_states (user_id, next_review_at);

CREATE TABLE course.srs_review_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    grade course.srs_grade NOT NULL,
    interval_before NUMERIC(8, 2),
    interval_after NUMERIC(8, 2) NOT NULL,
    ef_before NUMERIC(4, 3),
    ef_after NUMERIC(4, 3) NOT NULL,
    response_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_srs_events_user_time ON course.srs_review_events (user_id, created_at DESC);

CREATE TABLE course.srs_streak_days (
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    day_utc DATE NOT NULL,
    PRIMARY KEY (user_id, day_utc)
);

COMMENT ON TABLE course.srs_item_states IS 'Per-learner SRS scheduling state for question-bank items (SM-2 by default).';
COMMENT ON TABLE course.srs_review_events IS 'Append-only SRS grade log for audit and future FSRS calibration.';
COMMENT ON TABLE course.srs_streak_days IS 'UTC calendar days when the learner cleared all due SRS items.';
