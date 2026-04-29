-- Canonical display names and roster/search ordering for course.course_enrollments.role.

CREATE TABLE course.enrollment_roles (
    role_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

COMMENT ON TABLE course.enrollment_roles IS 'Labels and UI sort order for values of course.course_enrollments.role.';

INSERT INTO course.enrollment_roles (role_key, display_name, sort_order)
VALUES ('teacher', 'Teacher', 0),
       ('instructor', 'Instructor', 1),
       ('student', 'Student', 2);
