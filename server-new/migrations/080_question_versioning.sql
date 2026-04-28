-- Question versioning history and delivered-version snapshots for attempts.

ALTER TABLE course.questions
    ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS course.question_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES course.questions(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    snapshot JSONB NOT NULL,
    change_note TEXT,
    change_summary JSONB,
    created_by UUID REFERENCES "user".users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (question_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_qv_question
    ON course.question_versions (question_id, version_number DESC);

ALTER TABLE course.attempt_question_selections
    ADD COLUMN IF NOT EXISTS version_number INTEGER NOT NULL DEFAULT 1;

INSERT INTO course.question_versions (
    question_id,
    version_number,
    snapshot,
    change_note,
    change_summary,
    created_by
)
SELECT
    q.id,
    q.version_number,
    jsonb_build_object(
        'id', q.id,
        'course_id', q.course_id,
        'question_type', q.question_type::text,
        'stem', q.stem,
        'options', q.options,
        'correct_answer', q.correct_answer,
        'explanation', q.explanation,
        'points', q.points::float8,
        'status', q.status::text,
        'shared', q.shared,
        'source', q.source,
        'metadata', q.metadata,
        'irt_a', q.irt_a::float8,
        'irt_b', q.irt_b::float8,
        'irt_status', q.irt_status,
        'created_by', q.created_by,
        'created_at', q.created_at,
        'updated_at', q.updated_at,
        'version_number', q.version_number,
        'is_published', q.is_published
    ),
    'Initial version snapshot',
    NULL,
    q.created_by
FROM course.questions q
WHERE NOT EXISTS (
    SELECT 1
    FROM course.question_versions qv
    WHERE qv.question_id = q.id
      AND qv.version_number = q.version_number
);
