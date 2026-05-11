-- Plan 5.9: extended course enrollment roles (TA, Designer, Observer, Auditor, Librarian).

ALTER TABLE course.course_enrollments
    DROP CONSTRAINT IF EXISTS course_enrollments_role_check;

ALTER TABLE course.course_enrollments
    ADD CONSTRAINT course_enrollments_role_check CHECK (
        role IN (
            'owner',
            'teacher',
            'instructor',
            'student',
            'ta',
            'designer',
            'observer',
            'auditor',
            'librarian'
        )
    );

INSERT INTO course.enrollment_roles (role_key, display_name, sort_order)
VALUES ('ta', 'Teaching assistant', 15),
       ('designer', 'Designer', 16),
       ('observer', 'Observer', 17),
       ('auditor', 'Auditor', 18),
       ('librarian', 'Librarian', 19)
ON CONFLICT (role_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    sort_order   = EXCLUDED.sort_order;
