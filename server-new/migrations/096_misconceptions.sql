-- 1.10 Misconception detection & remediation: library, option tags, events, course flag.

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS misconception_detection_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN course.courses.misconception_detection_enabled IS 'When true, tagged distractors record misconception events and return remediation in quiz results.';

CREATE TABLE course.misconceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    concept_id UUID REFERENCES course.concepts (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    remediation_body TEXT,
    remediation_url TEXT,
    locale TEXT NOT NULL DEFAULT 'en',
    is_seed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_misconceptions_course ON course.misconceptions (course_id);

CREATE INDEX idx_misconceptions_concept ON course.misconceptions (concept_id);

CREATE INDEX idx_misconceptions_course_name_fts ON course.misconceptions USING gin (
    to_tsvector(
        'english',
        name || ' ' || COALESCE(description, '')
    )
);

CREATE TABLE course.question_option_misconception_tags (
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    option_id UUID NOT NULL,
    misconception_id UUID NOT NULL REFERENCES course.misconceptions (id) ON DELETE CASCADE,
    PRIMARY KEY (question_id, option_id)
);

CREATE INDEX idx_qomt_misconception ON course.question_option_misconception_tags (misconception_id);

COMMENT ON TABLE course.question_option_misconception_tags IS 'Maps a stable per-option UUID (stored in questions.options JSON) to a course misconception.';

CREATE TABLE course.misconception_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES course.quiz_attempts (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    misconception_id UUID NOT NULL REFERENCES course.misconceptions (id) ON DELETE CASCADE,
    selected_option_id UUID,
    remediation_shown BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_me_user_m ON course.misconception_events (user_id, misconception_id);

CREATE INDEX idx_me_course_m ON course.misconception_events (course_id, misconception_id);

CREATE INDEX idx_me_attempt ON course.misconception_events (attempt_id);

CREATE INDEX idx_me_question ON course.misconception_events (question_id);
