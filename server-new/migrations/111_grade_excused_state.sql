-- Plan 3.12: excused assignments are excluded from averages, drops, and SBG rollups; shown as EX in UI.
ALTER TABLE course.course_grades
    ADD COLUMN excused BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN course.course_grades.excused IS
    'When true, the score is kept for the record but excluded from course and group grade calculations.';
