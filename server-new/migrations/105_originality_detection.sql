-- Plan 3.5 — plagiarism / AI-content detection: reports per submission + assignment toggles + platform config.

CREATE TABLE IF NOT EXISTS course.originality_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES course.module_assignment_submissions (id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('turnitin', 'copyleaks', 'gptzero', 'internal')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
    similarity_pct NUMERIC(5, 2),
    ai_probability NUMERIC(5, 2),
    report_url TEXT,
    report_token TEXT,
    provider_report_id TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT originality_reports_submission_provider UNIQUE (submission_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_originality_reports_submission
    ON course.originality_reports (submission_id);

COMMENT ON TABLE course.originality_reports IS
    'Academic integrity scan results per submission (internal AI signal + external providers).';

ALTER TABLE course.module_assignments
    ADD COLUMN IF NOT EXISTS originality_detection TEXT NOT NULL DEFAULT 'disabled'
        CHECK (originality_detection IN ('disabled', 'plagiarism', 'ai', 'both')),
    ADD COLUMN IF NOT EXISTS originality_student_visibility TEXT NOT NULL DEFAULT 'hide'
        CHECK (originality_student_visibility IN ('show', 'hide', 'show_after_grading'));

COMMENT ON COLUMN course.module_assignments.originality_detection IS
    'Which originality checks run after submit: disabled | plagiarism | ai | both.';
COMMENT ON COLUMN course.module_assignments.originality_student_visibility IS
    'Whether learners may see similarity / AI scores: show | hide | show_after_grading.';

CREATE TABLE IF NOT EXISTS settings.originality_platform_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    dpa_accepted_at TIMESTAMPTZ,
    active_external_provider TEXT NOT NULL DEFAULT 'none'
        CHECK (active_external_provider IN ('none', 'turnitin', 'copyleaks', 'gptzero')),
    provider_api_key TEXT,
    webhook_hmac_secret TEXT,
    similarity_amber_min_pct NUMERIC(5, 2) NOT NULL DEFAULT 25,
    similarity_red_min_pct NUMERIC(5, 2) NOT NULL DEFAULT 50,
    ai_amber_min_pct NUMERIC(5, 2) NOT NULL DEFAULT 25,
    ai_red_min_pct NUMERIC(5, 2) NOT NULL DEFAULT 50,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings.originality_platform_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE settings.originality_platform_config IS
    'Singleton (id=1) institutional settings for third-party originality providers.';
