-- Plan 3.9: drop lowest/highest, never-drop, replace lowest with final (group + per-item flags).

ALTER TABLE course.assignment_groups
    ADD COLUMN drop_lowest INT NOT NULL DEFAULT 0,
    ADD COLUMN drop_highest INT NOT NULL DEFAULT 0,
    ADD COLUMN replace_lowest_with_final BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT assignment_groups_drop_lowest_check CHECK (drop_lowest >= 0),
    ADD CONSTRAINT assignment_groups_drop_highest_check CHECK (drop_highest >= 0);

ALTER TABLE course.module_assignments
    ADD COLUMN never_drop BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN replace_with_final BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE course.module_quizzes
    ADD COLUMN never_drop BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN replace_with_final BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN course.assignment_groups.drop_lowest IS 'Drop this many lowest scores in the group when computing the group contribution.';
COMMENT ON COLUMN course.assignment_groups.replace_lowest_with_final IS 'If true and a final is designated, a low non-final score can be replaced by the final percent.';
COMMENT ON COLUMN course.module_assignments.replace_with_final IS 'Marks the assignment that counts as the final for replace-lowest policy within its group.';
COMMENT ON COLUMN course.module_quizzes.replace_with_final IS 'Marks the quiz that counts as the final for replace-lowest policy within its group.';
