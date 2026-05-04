-- Plan 5.3 — Academic terms (semesters, quarters) scoped to organizations.

CREATE TABLE tenant.terms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES tenant.organizations (id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    term_type   TEXT NOT NULL DEFAULT 'semester'
        CHECK (term_type IN ('semester', 'quarter', 'trimester', 'year', 'grading_period', 'custom')),
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    status      TEXT NOT NULL DEFAULT 'upcoming'
        CHECK (status IN ('upcoming', 'active', 'completed', 'archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT terms_end_after_start CHECK (end_date > start_date)
);

CREATE INDEX idx_terms_org_status ON tenant.terms (org_id, status);

COMMENT ON TABLE tenant.terms IS 'Academic terms / grading periods per organization (plan 5.3).';

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS term_id UUID REFERENCES tenant.terms (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_term_id ON course.courses (term_id);
