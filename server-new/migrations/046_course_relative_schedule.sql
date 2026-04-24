-- Fixed vs enrollment-relative schedule: course-level window and timeline anchor for shifting module dates.

ALTER TABLE course.courses
    ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'fixed',
    ADD COLUMN relative_end_after TEXT NULL,
    ADD COLUMN relative_hidden_after TEXT NULL,
    ADD COLUMN relative_schedule_anchor_at TIMESTAMPTZ NULL;

ALTER TABLE course.courses
    ADD CONSTRAINT courses_schedule_mode_check CHECK (schedule_mode IN ('fixed', 'relative'));

COMMENT ON COLUMN course.courses.schedule_mode IS 'fixed: use starts_at/ends_at/visible_from/hidden_at. relative: window from each student enrollment; module dates shift from relative_schedule_anchor_at.';
COMMENT ON COLUMN course.courses.relative_end_after IS 'ISO 8601 duration (e.g. P90D, P3M) added to student enrollment for effective course end; NULL means no end.';
COMMENT ON COLUMN course.courses.relative_hidden_after IS 'ISO 8601 duration added to student enrollment for catalog visibility end; NULL means not hidden by schedule.';
COMMENT ON COLUMN course.courses.relative_schedule_anchor_at IS 'Reference start for authored module visible_from/due dates; shifted to each student enrollment start in relative mode.';
