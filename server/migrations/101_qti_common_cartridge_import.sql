-- QTI 2.1 / IMS Common Cartridge import jobs, idempotency, and review status (plan 2.13).

ALTER TYPE course.question_status ADD VALUE IF NOT EXISTS 'needs_review';

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS qti_import_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE course.import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    import_type TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total_items INTEGER,
    processed_items INTEGER NOT NULL DEFAULT 0,
    succeeded_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    skipped_items INTEGER NOT NULL DEFAULT 0,
    error_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_jobs_course ON course.import_jobs (course_id, created_at DESC);

CREATE INDEX idx_import_jobs_user ON course.import_jobs (created_by, created_at DESC);

CREATE TABLE course.imported_question_sources (
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES course.questions (id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_identifier TEXT NOT NULL,
    import_job_id UUID NOT NULL REFERENCES course.import_jobs (id) ON DELETE CASCADE,
    PRIMARY KEY (course_id, source_type, source_identifier)
);

CREATE INDEX idx_imported_question_sources_job ON course.imported_question_sources (import_job_id);

COMMENT ON TABLE course.import_jobs IS 'Async QTI / Common Cartridge package imports into the question bank (plan 2.13).';

COMMENT ON TABLE course.imported_question_sources IS 'Maps external QTI item identifiers to imported bank rows for idempotent re-import.';
