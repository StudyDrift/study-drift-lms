-- Time-limit timeout handling support: explicit auto-submit marker + lookup index.
ALTER TABLE course.quiz_attempts
    ADD COLUMN IF NOT EXISTS auto_submitted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_deadline_open
    ON course.quiz_attempts (deadline_at)
    WHERE deadline_at IS NOT NULL AND status = 'in_progress';
