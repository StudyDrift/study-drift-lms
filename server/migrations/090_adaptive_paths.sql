-- Adaptive paths across modules: rule-based branching, overrides, audit events.

CREATE TYPE course.path_rule_type AS ENUM (
    'skip_if_mastered',
    'required_if_not_mastered',
    'unlock_after',
    'remediation_insert'
);

CREATE TABLE course.structure_item_path_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    structure_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    rule_type course.path_rule_type NOT NULL,
    concept_ids UUID[] NOT NULL,
    threshold NUMERIC(4, 3) NOT NULL CHECK (
        threshold >= 0
        AND threshold <= 1
    ),
    target_item_id UUID REFERENCES course.course_structure_items (id) ON DELETE SET NULL,
    priority SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT structure_item_path_rules_concepts_nonempty CHECK (cardinality(concept_ids) >= 1)
);

CREATE INDEX idx_structure_item_path_rules_item ON course.structure_item_path_rules (structure_item_id);

CREATE TABLE course.enrollment_path_overrides (
    enrollment_id UUID NOT NULL REFERENCES course.course_enrollments (id) ON DELETE CASCADE,
    item_sequence UUID[] NOT NULL,
    created_by UUID NOT NULL REFERENCES "user".users (id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (enrollment_id),
    CONSTRAINT enrollment_path_overrides_sequence_nonempty CHECK (cardinality(item_sequence) >= 1)
);

-- Append-only audit log (monthly partitions can be added later without blocking inserts).
CREATE TABLE course.learner_path_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL REFERENCES course.course_enrollments (id) ON DELETE CASCADE,
    from_item_id UUID REFERENCES course.course_structure_items (id) ON DELETE SET NULL,
    to_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    rule_id UUID REFERENCES course.structure_item_path_rules (id) ON DELETE SET NULL,
    was_override BOOLEAN NOT NULL DEFAULT FALSE,
    was_fallback BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_learner_path_events_enrollment ON course.learner_path_events (enrollment_id, created_at DESC);

CREATE INDEX idx_learner_path_events_created_brin ON course.learner_path_events USING BRIN (created_at);

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS adaptive_paths_enabled BOOLEAN NOT NULL DEFAULT FALSE;
