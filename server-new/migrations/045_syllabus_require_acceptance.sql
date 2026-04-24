-- Optional gate: learners must acknowledge syllabus content once per course.
ALTER TABLE course.course_syllabus
    ADD COLUMN require_syllabus_acceptance BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN course.course_syllabus.require_syllabus_acceptance IS
    'When true, enrolled learners must confirm they reviewed the syllabus before using the course (first visit).';

CREATE TABLE course.syllabus_acceptances (
    user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, course_id)
);

CREATE INDEX idx_syllabus_acceptances_course ON course.syllabus_acceptances (course_id);

COMMENT ON TABLE course.syllabus_acceptances IS
    'Records that a user acknowledged the syllabus for a course (one row per user per course).';
