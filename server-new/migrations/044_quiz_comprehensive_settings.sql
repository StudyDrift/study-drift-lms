-- Extended quiz delivery, grading, timing, review, presentation, security, adaptive, and pool settings.
ALTER TABLE course.module_quizzes
    ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN grade_attempt_policy TEXT NOT NULL DEFAULT 'latest',
    ADD COLUMN passing_score_percent INTEGER NULL,
    ADD COLUMN late_submission_policy TEXT NOT NULL DEFAULT 'allow',
    ADD COLUMN late_penalty_percent INTEGER NULL,
    ADD COLUMN time_limit_minutes INTEGER NULL,
    ADD COLUMN timer_pause_when_tab_hidden BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN per_question_time_limit_seconds INTEGER NULL,
    ADD COLUMN show_score_timing TEXT NOT NULL DEFAULT 'immediate',
    ADD COLUMN review_visibility TEXT NOT NULL DEFAULT 'full',
    ADD COLUMN review_when TEXT NOT NULL DEFAULT 'always',
    ADD COLUMN shuffle_questions BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN shuffle_choices BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN allow_back_navigation BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN quiz_access_code TEXT NULL,
    ADD COLUMN adaptive_difficulty TEXT NOT NULL DEFAULT 'standard',
    ADD COLUMN adaptive_topic_balance BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN adaptive_stop_rule TEXT NOT NULL DEFAULT 'fixed_count',
    ADD COLUMN random_question_pool_count INTEGER NULL;

ALTER TABLE course.module_quizzes
    ADD CONSTRAINT module_quizzes_max_attempts_check CHECK (max_attempts >= 1 AND max_attempts <= 100),
    ADD CONSTRAINT module_quizzes_grade_attempt_policy_check CHECK (
        grade_attempt_policy IN ('highest', 'latest', 'first', 'average')
    ),
    ADD CONSTRAINT module_quizzes_passing_score_check CHECK (
        passing_score_percent IS NULL
        OR (passing_score_percent >= 0 AND passing_score_percent <= 100)
    ),
    ADD CONSTRAINT module_quizzes_late_submission_policy_check CHECK (
        late_submission_policy IN ('allow', 'penalty', 'block')
    ),
    ADD CONSTRAINT module_quizzes_late_penalty_check CHECK (
        late_penalty_percent IS NULL
        OR (late_penalty_percent >= 0 AND late_penalty_percent <= 100)
    ),
    ADD CONSTRAINT module_quizzes_time_limit_check CHECK (
        time_limit_minutes IS NULL
        OR (time_limit_minutes >= 1 AND time_limit_minutes <= 10080)
    ),
    ADD CONSTRAINT module_quizzes_per_q_time_check CHECK (
        per_question_time_limit_seconds IS NULL
        OR (
            per_question_time_limit_seconds >= 10
            AND per_question_time_limit_seconds <= 86400
        )
    ),
    ADD CONSTRAINT module_quizzes_show_score_timing_check CHECK (
        show_score_timing IN ('immediate', 'after_due', 'manual')
    ),
    ADD CONSTRAINT module_quizzes_review_visibility_check CHECK (
        review_visibility IN ('none', 'score_only', 'responses', 'correct_answers', 'full')
    ),
    ADD CONSTRAINT module_quizzes_review_when_check CHECK (
        review_when IN ('after_submit', 'after_due', 'always', 'never')
    ),
    ADD CONSTRAINT module_quizzes_adaptive_difficulty_check CHECK (
        adaptive_difficulty IN ('introductory', 'standard', 'challenging')
    ),
    ADD CONSTRAINT module_quizzes_adaptive_stop_rule_check CHECK (
        adaptive_stop_rule IN ('fixed_count', 'mastery_estimate')
    ),
    ADD CONSTRAINT module_quizzes_random_pool_check CHECK (
        random_question_pool_count IS NULL
        OR (
            random_question_pool_count >= 1
            AND random_question_pool_count <= 300
        )
    );

COMMENT ON COLUMN course.module_quizzes.max_attempts IS
    'Used when unlimited_attempts is false (1–100). Ignored when unlimited_attempts is true.';
COMMENT ON COLUMN course.module_quizzes.grade_attempt_policy IS
    'Which attempt counts for the grade: highest, latest, first, or average.';
COMMENT ON COLUMN course.module_quizzes.passing_score_percent IS
    'Optional 0–100; null means no passing threshold.';
COMMENT ON COLUMN course.module_quizzes.late_submission_policy IS
    'allow: submit after due; penalty: apply late_penalty_percent to score; block: cannot submit after due.';
COMMENT ON COLUMN course.module_quizzes.quiz_access_code IS
    'Optional plaintext code learners must enter before starting (max 128 chars).';
