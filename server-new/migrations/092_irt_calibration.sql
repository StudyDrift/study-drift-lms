-- IRT 2PL calibration, learner theta, CAT delivery mode (plan 1.6).

CREATE TYPE course.irt_calibration_status AS ENUM (
    'uncalibrated',
    'pilot',
    'calibrated',
    'retired'
);

ALTER TABLE course.questions
    ALTER COLUMN irt_status DROP DEFAULT;

ALTER TABLE course.questions
    ALTER COLUMN irt_status TYPE course.irt_calibration_status
    USING (
        CASE lower(trim(irt_status::text))
            WHEN 'pilot' THEN 'pilot'::course.irt_calibration_status
            WHEN 'calibrated' THEN 'calibrated'::course.irt_calibration_status
            WHEN 'retired' THEN 'retired'::course.irt_calibration_status
            ELSE 'uncalibrated'::course.irt_calibration_status
        END
    );

ALTER TABLE course.questions
    ALTER COLUMN irt_status SET DEFAULT 'uncalibrated'::course.irt_calibration_status;

ALTER TABLE course.questions
    ADD COLUMN IF NOT EXISTS irt_c NUMERIC(6, 4),
    ADD COLUMN IF NOT EXISTS irt_sample_n INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS irt_calibrated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_q_irt_status ON course.questions (irt_status);

ALTER TABLE course.learner_concept_states
    ADD COLUMN IF NOT EXISTS theta NUMERIC(6, 4),
    ADD COLUMN IF NOT EXISTS theta_se NUMERIC(6, 4);

-- Partitioned tables require every UNIQUE/PK to include the partition key (created_at).
CREATE TABLE course.learner_theta_events (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES course.concepts (id) ON DELETE CASCADE,
    attempt_id UUID REFERENCES course.quiz_attempts (id) ON DELETE SET NULL,
    theta NUMERIC(6, 4) NOT NULL,
    theta_se NUMERIC(6, 4),
    items_n INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE course.learner_theta_events_default PARTITION OF course.learner_theta_events
    DEFAULT;

CREATE INDEX idx_lte_user ON course.learner_theta_events (user_id);

CREATE INDEX idx_lte_concept ON course.learner_theta_events (concept_id);

ALTER TABLE course.module_quizzes
    ADD COLUMN IF NOT EXISTS adaptive_delivery_mode TEXT NOT NULL DEFAULT 'ai'
        CHECK (adaptive_delivery_mode IN ('ai', 'cat'));

COMMENT ON COLUMN course.module_quizzes.adaptive_delivery_mode IS
    'Adaptive quiz: ai = LLM-generated items; cat = IRT pool-based computerized adaptive testing.';

COMMENT ON TABLE course.learner_theta_events IS
    'Append-only log of EAP theta updates after CAT / calibrated adaptive sessions.';
