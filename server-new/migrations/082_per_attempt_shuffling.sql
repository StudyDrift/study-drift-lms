-- Per-attempt option order (stable across reloads) and per-question shuffle override.

ALTER TABLE course.questions
    ADD COLUMN IF NOT EXISTS shuffle_choices_override BOOLEAN;

COMMENT ON COLUMN course.questions.shuffle_choices_override IS
    'When NULL, inherit quiz shuffle_choices. When FALSE, keep authored option order for this item.';

CREATE TABLE IF NOT EXISTS course.attempt_option_orders (
    attempt_id UUID NOT NULL REFERENCES course.quiz_attempts (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    option_order SMALLINT[] NOT NULL,
    PRIMARY KEY (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_attempt_option_orders_attempt
    ON course.attempt_option_orders (attempt_id);

COMMENT ON TABLE course.attempt_option_orders IS
    'Per-attempt permutation of MC/TF options: option_order[i] is the authored index shown at display position i.';
