-- Plan 5.4 — Course sections (rosters, gradebook scope, due-date overrides).

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS sections_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN course.courses.sections_enabled IS 'When true, section-scoped rosters and gradebook filtering apply (plan 5.4).';

CREATE TABLE course.course_sections (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id            UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    term_id              UUID REFERENCES tenant.terms (id) ON DELETE SET NULL,
    section_code         TEXT NOT NULL,
    name                 TEXT,
    instructor_user_id   UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    capacity             INTEGER,
    meeting_info         JSONB NOT NULL DEFAULT '{}',
    status               TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'cancelled', 'archived')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (course_id, section_code)
);

CREATE INDEX idx_course_sections_course ON course.course_sections (course_id, status);

COMMENT ON TABLE course.course_sections IS 'Teaching sections under one course shell (plan 5.4).';

ALTER TABLE course.course_enrollments
    ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES course.course_sections (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_course_enrollments_section ON course.course_enrollments (section_id);

-- Section-level due dates / availability for assignments (structure items).
CREATE TABLE course.section_assignment_overrides (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID NOT NULL REFERENCES course.course_sections (id) ON DELETE CASCADE,
    structure_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    due_at          TIMESTAMPTZ,
    available_from  TIMESTAMPTZ,
    available_until TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (section_id, structure_item_id)
);

CREATE INDEX idx_section_overrides_section ON course.section_assignment_overrides (section_id);
