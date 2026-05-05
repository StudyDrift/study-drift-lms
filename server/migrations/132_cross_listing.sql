-- Plan 5.5 — Cross-listing: merge section rosters in one gradebook (same course).

CREATE TABLE course.cross_list_groups (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES tenant.organizations (id),
    course_id  UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    name       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uniq_cross_list_one_group_per_course UNIQUE (course_id)
);

COMMENT ON TABLE course.cross_list_groups IS 'Cross-listed teaching shells for one course (plan 5.5).';

CREATE TABLE course.cross_list_members (
    group_id    UUID NOT NULL REFERENCES course.cross_list_groups (id) ON DELETE CASCADE,
    section_id  UUID NOT NULL REFERENCES course.course_sections (id) ON DELETE CASCADE,
    is_primary  BOOLEAN NOT NULL DEFAULT false,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, section_id),
    UNIQUE (section_id)
);

CREATE INDEX idx_cross_list_members_group ON course.cross_list_members (group_id);

COMMENT ON TABLE course.cross_list_members IS 'Sections merged into a cross-list group; at most one group per section.';
