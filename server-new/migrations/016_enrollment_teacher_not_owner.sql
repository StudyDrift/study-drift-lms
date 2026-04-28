-- Course creators are enrolled as `teacher` (not `owner`) and rely on RBAC `Teacher` for permissions.
--
-- The original column CHECK only allowed owner/instructor/student, so we must drop it before assigning
-- `teacher`. Otherwise the first UPDATE fails (or never applies) and ADD CONSTRAINT can still see `owner`.

-- Drop every CHECK on this table (covers auto-generated names across PG versions).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'course'
      AND t.relname = 'course_enrollments'
      AND c.contype = 'c'
  ) LOOP
    EXECUTE format('ALTER TABLE course.course_enrollments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

UPDATE course.course_enrollments ce
SET role = 'teacher'
FROM course.courses c
WHERE ce.course_id = c.id
  AND ce.user_id = c.created_by_user_id
  AND lower(trim(ce.role)) = 'owner';

UPDATE course.course_enrollments
SET role = 'instructor'
WHERE lower(trim(role)) = 'owner';

-- Canonicalize casing so the final CHECK matches.
UPDATE course.course_enrollments SET role = 'teacher' WHERE lower(trim(role)) = 'teacher';
UPDATE course.course_enrollments SET role = 'instructor' WHERE lower(trim(role)) = 'instructor';
UPDATE course.course_enrollments SET role = 'student' WHERE lower(trim(role)) = 'student';

-- Any unexpected values become student so the new CHECK can be applied safely.
UPDATE course.course_enrollments
SET role = 'student'
WHERE role NOT IN ('instructor', 'student', 'teacher');

ALTER TABLE course.course_enrollments
    ADD CONSTRAINT course_enrollments_role_check CHECK (role IN ('instructor', 'student', 'teacher'));
