-- Optional gradebook weight: how many points a quiz or assignment counts for (null = unset).
ALTER TABLE course.module_quizzes
    ADD COLUMN points_worth INTEGER NULL,
    ADD CONSTRAINT module_quizzes_points_worth_check CHECK (
        points_worth IS NULL OR (points_worth >= 0 AND points_worth <= 1000000)
    );

ALTER TABLE course.module_assignments
    ADD COLUMN points_worth INTEGER NULL,
    ADD CONSTRAINT module_assignments_points_worth_check CHECK (
        points_worth IS NULL OR (points_worth >= 0 AND points_worth <= 1000000)
    );

COMMENT ON COLUMN course.module_quizzes.points_worth IS
    'Optional points this quiz counts toward the gradebook; null means not set.';
COMMENT ON COLUMN course.module_assignments.points_worth IS
    'Optional points this assignment counts toward the gradebook; null means not set.';
