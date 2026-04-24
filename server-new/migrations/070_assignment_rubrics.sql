-- Structured rubrics for module assignments (criteria with point-band levels).
ALTER TABLE course.module_assignments
    ADD COLUMN rubric_json JSONB;

COMMENT ON COLUMN course.module_assignments.rubric_json IS
    'Optional rubric: criteria with ordered levels (label + points).';

-- Per-criterion scores for a grade cell when the assignment uses a rubric.
ALTER TABLE course.course_grades
    ADD COLUMN rubric_scores_json JSONB;

COMMENT ON COLUMN course.course_grades.rubric_scores_json IS
    'Map of rubric criterion id to points earned; total should match points_earned.';
