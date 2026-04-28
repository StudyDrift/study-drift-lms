-- Quiz delivery / presentation settings (stored on module_quizzes; due date remains on structure item).
ALTER TABLE course.module_quizzes
    ADD COLUMN available_from TIMESTAMPTZ NULL,
    ADD COLUMN available_until TIMESTAMPTZ NULL,
    ADD COLUMN unlimited_attempts BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN one_question_at_a_time BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN course.module_quizzes.available_from IS
    'If set, learners may open the quiz on or after this instant (UTC). Null means no start window.';
COMMENT ON COLUMN course.module_quizzes.available_until IS
    'If set, learners may not open the quiz after this instant (UTC). Null means no end window.';
COMMENT ON COLUMN course.module_quizzes.unlimited_attempts IS
    'When true, retakes are not limited by attempt count (enforcement is LMS-specific).';
COMMENT ON COLUMN course.module_quizzes.one_question_at_a_time IS
    'When true, the learner UI should show one question per step instead of the full list.';
