-- Per-user learning activity timestamps (course visits, content open/leave).
CREATE TABLE "user".user_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    structure_item_id UUID REFERENCES course.course_structure_items (id) ON DELETE SET NULL,
    event_kind TEXT NOT NULL CHECK (event_kind IN ('course_visit', 'content_open', 'content_leave')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_audit_structure_item_kind CHECK (
        (event_kind = 'course_visit' AND structure_item_id IS NULL)
        OR (event_kind IN ('content_open', 'content_leave') AND structure_item_id IS NOT NULL)
    )
);

CREATE INDEX idx_user_audit_user_occurred ON "user".user_audit (user_id, occurred_at DESC);
CREATE INDEX idx_user_audit_course_occurred ON "user".user_audit (course_id, occurred_at DESC);
