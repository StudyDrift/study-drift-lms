-- Plan 5.6 — Course blueprints: master courses linked to child copies with sync logs.

ALTER TABLE course.courses
    ADD COLUMN IF NOT EXISTS is_blueprint BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS blueprint_parent_id UUID REFERENCES course.courses (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS blueprint_last_sync_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_courses_blueprint_parent ON course.courses (blueprint_parent_id);

ALTER TABLE course.courses
    ADD CONSTRAINT courses_blueprint_not_self CHECK (
        blueprint_parent_id IS NULL OR blueprint_parent_id <> id
    );

ALTER TABLE course.course_structure_items
    ADD COLUMN IF NOT EXISTS blueprint_locked BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS blueprint_origin_id UUID;

CREATE INDEX IF NOT EXISTS idx_course_structure_blueprint_origin
    ON course.course_structure_items (course_id, blueprint_origin_id);

CREATE TABLE course.blueprint_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    blueprint_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    triggered_by UUID NOT NULL REFERENCES "user".users (id),
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    children_total INTEGER NOT NULL DEFAULT 0,
    children_success INTEGER NOT NULL DEFAULT 0,
    children_error INTEGER NOT NULL DEFAULT 0,
    log_detail JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_blueprint_sync_logs_blueprint_triggered
    ON course.blueprint_sync_logs (blueprint_id, triggered_at DESC);

COMMENT ON COLUMN course.courses.is_blueprint IS 'When true, other courses may link as blueprint children.';
COMMENT ON COLUMN course.courses.blueprint_parent_id IS 'Optional master blueprint course this course copies from.';
COMMENT ON COLUMN course.course_structure_items.blueprint_locked IS 'When true, district blueprint controls this row; teachers cannot edit without org admin.';
COMMENT ON COLUMN course.course_structure_items.blueprint_origin_id IS 'Structure item id in the blueprint course this row was copied from.';
