-- Lockdown / kiosk / server-enforced one-question-at-a-time delivery (see plan 2.10).

CREATE TYPE course.lockdown_mode AS ENUM ('standard', 'one_at_a_time', 'kiosk');

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS lockdown_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE course.module_quizzes
    ADD COLUMN lockdown_mode course.lockdown_mode NOT NULL DEFAULT 'standard',
    ADD COLUMN focus_loss_threshold INTEGER NULL,
    ADD CONSTRAINT module_quizzes_focus_loss_threshold_check CHECK (
        focus_loss_threshold IS NULL OR (focus_loss_threshold >= 1 AND focus_loss_threshold <= 1000)
    );

UPDATE course.module_quizzes
SET lockdown_mode = 'one_at_a_time'
WHERE one_question_at_a_time = TRUE;

ALTER TABLE course.quiz_attempts
    ADD COLUMN current_question_index INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN academic_integrity_flag BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE course.quiz_responses
    ADD COLUMN locked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE course.attempt_focus_loss_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES course.quiz_attempts (id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    duration_ms INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_afle_attempt ON course.attempt_focus_loss_events (attempt_id);

COMMENT ON COLUMN course.module_quizzes.lockdown_mode IS
    'Delivery mode: standard (full quiz), one_at_a_time (server-enforced forward-only), kiosk (one_at_a_time + focus logging).';
COMMENT ON COLUMN course.module_quizzes.focus_loss_threshold IS
    'When set, submitted kiosk-mode attempts exceed this many focus-loss events get academic_integrity_flag.';
COMMENT ON COLUMN course.quiz_attempts.current_question_index IS
    'For lockdown modes: next question index to serve (0-based); equals question count when ready to submit.';
COMMENT ON COLUMN course.quiz_responses.locked IS
    'When true, answer was finalized by advancing in lockdown mode and cannot be changed.';
COMMENT ON TABLE course.attempt_focus_loss_events IS
    'Client-reported focus loss (tab switch, blur) during kiosk-mode attempts.';
