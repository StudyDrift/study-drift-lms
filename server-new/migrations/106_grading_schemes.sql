-- Plan 3.6: course-level grading schemes (letter / GPA / pass-fail / complete-incomplete) and per-assignment overrides.

CREATE TABLE course.grading_schemes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES course.courses (id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Default',
    grading_display_type TEXT NOT NULL CHECK (
        grading_display_type IN (
            'points',
            'percentage',
            'letter',
            'gpa',
            'pass_fail',
            'complete_incomplete'
        )
    ),
    scale_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grading_schemes_course_id ON course.grading_schemes (course_id);

ALTER TABLE course.courses
    ADD COLUMN grading_scheme_id UUID REFERENCES course.grading_schemes (id) ON DELETE SET NULL;

ALTER TABLE course.module_assignments
    ADD COLUMN grading_type TEXT CHECK (
        grading_type IS NULL
        OR grading_type IN (
            'points',
            'percentage',
            'letter',
            'gpa',
            'pass_fail',
            'complete_incomplete'
        )
    );

COMMENT ON TABLE course.grading_schemes IS
    'Course grading display configuration; numeric scores stay in course_grades.points_earned.';
