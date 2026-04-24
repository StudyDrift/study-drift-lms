-- Plan 3.14 — persist originality provider JSON and text snapshot in object storage (keys on row).

ALTER TABLE course.originality_reports
    ADD COLUMN IF NOT EXISTS report_storage_key TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_storage_key TEXT;

COMMENT ON COLUMN course.originality_reports.report_storage_key IS
    'Relative key under the course file store for the stored provider / detection JSON (originality-reports/…). NULL if not yet written or pre-migration row.';
COMMENT ON COLUMN course.originality_reports.snapshot_storage_key IS
    'Plain-text snapshot of the submission at detection time, same object store. NULL if unavailable.';
