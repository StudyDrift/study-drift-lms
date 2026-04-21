-- Inline grader annotations (highlights, drawings, text, pins) keyed to assignment submissions.

CREATE TABLE course.submission_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES course.module_assignment_submissions (id) ON DELETE CASCADE,
    annotator_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    page INT NOT NULL DEFAULT 1,
    tool_type TEXT NOT NULL CHECK (tool_type IN ('highlight', 'draw', 'text', 'pin')),
    colour TEXT NOT NULL DEFAULT '#FFFF00',
    coords_json JSONB NOT NULL,
    body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT submission_annotations_idem UNIQUE (submission_id, annotator_id, client_id)
);

CREATE INDEX idx_submission_annotations_submission
    ON course.submission_annotations (submission_id)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE course.submission_annotations IS
    'Instructor/TA markup on a student submission PDF; coords_json stores normalized overlay geometry.';
