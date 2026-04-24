-- Repair: some databases had migration 048 marked applied without this table existing
-- (e.g. checksum alignment without re-running DDL). Idempotent for everyone else.

CREATE TABLE IF NOT EXISTS course.user_course_catalog_order (
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    sort_order INT NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_user_course_catalog_order_user_sort
    ON course.user_course_catalog_order (user_id, sort_order);

COMMENT ON TABLE course.user_course_catalog_order IS
    'Optional display order for enrolled courses in the signed-in user''s course catalog.';
