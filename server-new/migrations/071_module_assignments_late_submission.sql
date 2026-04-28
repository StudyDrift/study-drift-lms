-- Late submission policy for module assignments (mirrors module_quizzes).
ALTER TABLE course.module_assignments
    ADD COLUMN late_submission_policy TEXT NOT NULL DEFAULT 'allow',
    ADD COLUMN late_penalty_percent INTEGER NULL;

ALTER TABLE course.module_assignments
    ADD CONSTRAINT module_assignments_late_submission_policy_check CHECK (
        late_submission_policy IN ('allow', 'penalty', 'block')
    );

ALTER TABLE course.module_assignments
    ADD CONSTRAINT module_assignments_late_penalty_check CHECK (
        late_penalty_percent IS NULL
        OR (late_penalty_percent >= 0 AND late_penalty_percent <= 100)
    );

COMMENT ON COLUMN course.module_assignments.late_submission_policy IS
    'allow: accept work after due; penalty: apply late_penalty_percent to the earned score; block: reject submissions after due when enforced.';
