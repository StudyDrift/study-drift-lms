-- Binary assets (e.g. embedded images) for course content; files live under COURSE_FILES_ROOT/<course_code>/.

CREATE TABLE course.course_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL CHECK (byte_size >= 0 AND byte_size <= 20971520),
    uploaded_by UUID REFERENCES "user".users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_course_files_storage_key ON course.course_files (storage_key);
CREATE INDEX idx_course_files_course_created ON course.course_files (course_id, created_at DESC);
