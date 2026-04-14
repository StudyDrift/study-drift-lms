-- Per-user highlights and notebook quotes on the course syllabus (not a structure item).

CREATE TABLE course.syllabus_user_markups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('highlight', 'note')),
    quote_text TEXT NOT NULL,
    notebook_page_id TEXT NULL,
    comment_text TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT syllabus_user_markups_note_fields CHECK (
        (kind = 'highlight' AND notebook_page_id IS NULL AND comment_text IS NULL)
        OR (kind = 'note' AND notebook_page_id IS NOT NULL)
    )
);

CREATE INDEX idx_syllabus_user_markups_user_course
    ON course.syllabus_user_markups (user_id, course_id);

CREATE INDEX idx_syllabus_user_markups_course
    ON course.syllabus_user_markups (course_id);

COMMENT ON TABLE course.syllabus_user_markups IS
    'Student highlights and notes captured from the syllabus document.';
