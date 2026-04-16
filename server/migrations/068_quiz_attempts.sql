-- Quiz student attempts: tracks submission history, answers, and scoring.
CREATE TABLE course.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    student_user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    quiz_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    time_spent_seconds INTEGER,
    score DOUBLE PRECISION,
    max_score DOUBLE PRECISION,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_user_id, quiz_item_id, attempt_number)
);

CREATE INDEX idx_quiz_attempts_course_id ON course.quiz_attempts (course_id);
CREATE INDEX idx_quiz_attempts_student_quiz ON course.quiz_attempts (student_user_id, quiz_item_id);
CREATE INDEX idx_quiz_attempts_submitted ON course.quiz_attempts (submitted_at DESC);

COMMENT ON TABLE course.quiz_attempts IS
    'Student quiz submission attempts with answers, timing, and scores.';
COMMENT ON COLUMN course.quiz_attempts.answers_json IS
    'Array of answer objects: [{questionIndex: i, selectedChoiceIndex: i | null, textAnswer: string | null}, ...]';
COMMENT ON COLUMN course.quiz_attempts.time_spent_seconds IS
    'Elapsed time from start to submission in seconds; null if in-progress.';
COMMENT ON COLUMN course.quiz_attempts.score IS
    'Points earned on this attempt; null if not yet graded or in-progress.';
COMMENT ON COLUMN course.quiz_attempts.max_score IS
    'Total possible points for the quiz at time of submission.';
