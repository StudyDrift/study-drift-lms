-- Instructor audio/video feedback on assignment submissions (plan 3.2).
-- Blobs are stored on disk under COURSE_FILES_ROOT/feedback/<course_code>/ (see services::feedback_media).

CREATE TABLE course.submission_feedback_media (
    id UUID PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES course.module_assignment_submissions (id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    module_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES "user".users (id),
    media_type TEXT NOT NULL CHECK (media_type IN ('audio', 'video')),
    mime_type TEXT NOT NULL,
    -- Relative path under feedback/<course_code>/ (e.g. "<id>/media.webm")
    storage_key TEXT NOT NULL,
    -- Zero while chunked upload in progress; set to >0 on complete.
    byte_size BIGINT NOT NULL DEFAULT 0 CHECK (byte_size >= 0 AND byte_size <= 524288000),
    duration_secs INT,
    caption_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (caption_status IN ('pending', 'processing', 'done', 'failed')),
    -- Relative key for captions.vtt next to media, e.g. "<id>/captions.vtt"
    caption_key TEXT,
    upload_complete BOOLEAN NOT NULL DEFAULT false,
    expected_byte_size BIGINT,
    bytes_received BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_submission_feedback_media_submission
    ON course.submission_feedback_media (submission_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_submission_feedback_media_course_item
    ON course.submission_feedback_media (course_id, module_item_id)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE course.submission_feedback_media IS
    'Instructor A/V feedback attached to a module assignment submission; storage_key is under course_files_root/feedback/.';
