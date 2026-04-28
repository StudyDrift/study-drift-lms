-- Plan 3.10 — append-only grade-change audit; replaces course.grade_change_audit (3.4).

CREATE TABLE course.grade_audit_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stable per grade cell, computed in the app (UUIDv5) for all new events; backfilled rows use gen_random_uuid().
    grade_id            UUID NOT NULL,
    course_id           UUID NOT NULL,
    assignment_id       UUID NOT NULL,
    student_id          UUID NOT NULL,
    changed_by_user_id  UUID,
    action              TEXT NOT NULL CHECK (action IN
        ('created','updated','excused','unexcused','posted','retracted','deleted')),
    previous_score      NUMERIC(8,2),
    new_score             NUMERIC(8,2),
    previous_status       TEXT,
    new_status            TEXT,
    reason                TEXT,
    changed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE course.grade_audit_events IS
    'Append-only: every course_grades mutation; students see only own rows.';

-- Migrate from legacy table (3.4 JSON log).
INSERT INTO course.grade_audit_events (
    id, grade_id, course_id, assignment_id, student_id, changed_by_user_id,
    action, previous_score, new_score, previous_status, new_status, reason, changed_at
)
SELECT
    a.id,
    gen_random_uuid(),
    a.course_id,
    a.module_item_id,
    a.student_user_id,
    a.actor_user_id,
    CASE a.event_type
        WHEN 'grades_posted' THEN 'posted'
        WHEN 'grades_retracted' THEN 'retracted'
        WHEN 'reconciliation' THEN 'updated'
        WHEN 'provisional_grade' THEN 'updated'
        ELSE 'updated'
    END,
    NULL,
    CASE
        WHEN a.event_type = 'reconciliation' AND a.payload_json ? 'points' THEN
            (a.payload_json->>'points')::numeric(8,2)
        ELSE NULL
    END,
    CASE
        WHEN a.event_type = 'grades_posted' THEN 'unposted'
        WHEN a.event_type = 'grades_retracted' THEN 'posted'
        ELSE NULL
    END,
    CASE
        WHEN a.event_type = 'grades_posted' THEN 'posted'
        WHEN a.event_type = 'grades_retracted' THEN 'unposted'
        ELSE NULL
    END,
    COALESCE(
        a.payload_json::text,
        ''
    ),
    a.created_at
FROM course.grade_change_audit a;

-- Synthetic “created” snapshot for every existing course_grades cell (one row, backfilled at migration time).
INSERT INTO course.grade_audit_events (
    grade_id, course_id, assignment_id, student_id, changed_by_user_id,
    action, previous_score, new_score, previous_status, new_status, reason, changed_at
)
SELECT
    gen_random_uuid(),
    cg.course_id,
    cg.module_item_id,
    cg.student_user_id,
    NULL,
    'created',
    NULL,
    (cg.points_earned::numeric(8,2)),
    NULL,
    NULL,
    'Initial grade (backfill at migration; no history before this date).',
    cg.updated_at
FROM course.course_grades cg
WHERE NOT EXISTS (
    SELECT 1
    FROM course.grade_audit_events g
    WHERE g.course_id = cg.course_id
      AND g.assignment_id = cg.module_item_id
      AND g.student_id = cg.student_user_id
);

DROP TABLE course.grade_change_audit;

CREATE INDEX idx_grade_audit_events_grade_id ON course.grade_audit_events (grade_id, changed_at);
CREATE INDEX idx_grade_audit_events_cell ON course.grade_audit_events (course_id, assignment_id, student_id, changed_at DESC);
CREATE INDEX idx_grade_audit_events_student ON course.grade_audit_events (student_id, changed_at);

CREATE RULE no_update_grade_audit AS ON UPDATE TO course.grade_audit_events DO INSTEAD NOTHING;
CREATE RULE no_delete_grade_audit AS ON DELETE TO course.grade_audit_events DO INSTEAD NOTHING;
