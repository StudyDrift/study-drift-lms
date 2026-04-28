-- Courses created before default assignment groups were persisted showed a
-- placeholder "Assignments" row in Course Settings while `/grading` returned
-- an empty list, so quiz/assignment pickers had no options. Seed one group
-- for any course that still has none.

INSERT INTO course.assignment_groups (course_id, sort_order, name, weight_percent)
SELECT c.id, 0, 'Assignments', 100.0
FROM course.courses c
WHERE NOT EXISTS (
    SELECT 1 FROM course.assignment_groups ag WHERE ag.course_id = c.id
);
