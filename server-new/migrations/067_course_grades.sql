-- Per-student points earned for each gradable module item (assignment or quiz) in a course.
CREATE TABLE course.course_grades (
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    student_user_id UUID NOT NULL REFERENCES "user".users (id) ON DELETE CASCADE,
    module_item_id UUID NOT NULL REFERENCES course.course_structure_items (id) ON DELETE CASCADE,
    points_earned DOUBLE PRECISION NOT NULL CHECK (
        points_earned >= 0::double precision
        AND points_earned <= 1e9::double precision
    ),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (student_user_id, module_item_id)
);

CREATE INDEX idx_course_grades_course_id ON course.course_grades (course_id);

COMMENT ON TABLE course.course_grades IS
    'Instructor-entered points per student per gradable module item; used by the course gradebook.';
