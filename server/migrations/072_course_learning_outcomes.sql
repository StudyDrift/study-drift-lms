-- Instructor-defined learning outcomes and links to assignments, quizzes, or individual quiz questions.

CREATE TABLE course.course_learning_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_course_learning_outcomes_course_sort
    ON course.course_learning_outcomes (course_id, sort_order);

CREATE TABLE course.course_outcome_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outcome_id UUID NOT NULL REFERENCES course.course_learning_outcomes (id) ON DELETE CASCADE,
    structure_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('assignment', 'quiz', 'quiz_question')),
    quiz_question_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT course_outcome_links_question_id_check CHECK (
        (target_kind IN ('assignment', 'quiz') AND quiz_question_id = '')
        OR (target_kind = 'quiz_question' AND length(trim(quiz_question_id)) > 0)
    )
);

CREATE UNIQUE INDEX ux_course_outcome_links_unique_target
    ON course.course_outcome_links (outcome_id, structure_item_id, target_kind, quiz_question_id);

CREATE INDEX idx_course_outcome_links_outcome ON course.course_outcome_links (outcome_id);
CREATE INDEX idx_course_outcome_links_item ON course.course_outcome_links (structure_item_id);

COMMENT ON TABLE course.course_learning_outcomes IS
    'Course-level learning outcomes; staff map them to gradable module items for progress reporting.';
COMMENT ON TABLE course.course_outcome_links IS
    'Maps a learning outcome to an assignment, an entire quiz, or one quiz question (by stable question id).';
