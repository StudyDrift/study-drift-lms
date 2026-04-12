-- Assignment availability, access code, and submission type flags (mirrors quiz delivery patterns).
ALTER TABLE course.module_assignments
    ADD COLUMN available_from TIMESTAMPTZ NULL,
    ADD COLUMN available_until TIMESTAMPTZ NULL,
    ADD COLUMN assignment_access_code TEXT NULL,
    ADD COLUMN submission_allow_text BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN submission_allow_file_upload BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN submission_allow_url BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE course.module_assignments
    ADD CONSTRAINT module_assignments_submission_modes_check
    CHECK (submission_allow_text OR submission_allow_file_upload OR submission_allow_url);
