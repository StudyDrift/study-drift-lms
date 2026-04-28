-- Per-enrollment quiz overrides (extra attempts, optional time multiplier) for accommodations / instructor grants.

CREATE TABLE course.enrollment_quiz_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    enrollment_id UUID NOT NULL REFERENCES course.course_enrollments (id) ON DELETE CASCADE,
    quiz_id UUID NOT NULL REFERENCES course.module_quizzes (structure_item_id) ON DELETE CASCADE,
    extra_attempts INTEGER NOT NULL DEFAULT 0 CHECK (extra_attempts >= 0),
    time_multiplier NUMERIC(4, 2) CHECK (
        time_multiplier IS NULL
        OR time_multiplier >= 1.0
    ),
    created_by UUID NOT NULL REFERENCES "user".users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (enrollment_id, quiz_id)
);

CREATE INDEX idx_enrollment_quiz_overrides_enrollment ON course.enrollment_quiz_overrides (enrollment_id);

COMMENT ON TABLE course.enrollment_quiz_overrides IS
    'Per-student per-quiz overrides layered on top of quiz.max_attempts and student_accommodations.extra_attempts.';
