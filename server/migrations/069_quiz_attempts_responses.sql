-- Stored quiz attempts and per-question responses for module quizzes (static and adaptive).

CREATE TABLE course.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    structure_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    student_user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    attempt_number INT NOT NULL CHECK (attempt_number >= 1),
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'submitted')),
    is_adaptive BOOLEAN NOT NULL DEFAULT false,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    points_earned DOUBLE PRECISION,
    points_possible DOUBLE PRECISION,
    score_percent REAL,
    adaptive_history_json JSONB,
    UNIQUE (structure_item_id, student_user_id, attempt_number)
);

CREATE INDEX idx_quiz_attempts_course_item ON course.quiz_attempts (course_id, structure_item_id);
CREATE INDEX idx_quiz_attempts_student_course ON course.quiz_attempts (student_user_id, course_id);

CREATE TABLE course.quiz_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES course.quiz_attempts (id) ON DELETE CASCADE,
    question_index INT NOT NULL,
    question_id TEXT,
    question_type TEXT NOT NULL,
    prompt_snapshot TEXT,
    response_json JSONB NOT NULL,
    is_correct BOOLEAN,
    points_awarded DOUBLE PRECISION,
    max_points DOUBLE PRECISION NOT NULL,
    UNIQUE (attempt_id, question_index)
);

CREATE INDEX idx_quiz_responses_attempt ON course.quiz_responses (attempt_id);

COMMENT ON TABLE course.quiz_attempts IS
    'One learner session for a module quiz; rows move from in_progress to submitted.';
COMMENT ON TABLE course.quiz_responses IS
    'Per-question learner answers and auto-graded results for a quiz attempt.';
