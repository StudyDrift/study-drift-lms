-- Syllabus page content: ordered sections of markdown (block-style editing on the client).
CREATE TABLE course.course_syllabus (
    course_id UUID PRIMARY KEY REFERENCES course.courses (id) ON DELETE CASCADE,
    sections JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
