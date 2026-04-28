-- Drop URL short_code; use course_code in URLs. Pattern: C-[A-Z0-9]{6}, unique per course.

DROP INDEX IF EXISTS idx_courses_short_code;

-- Assign unique course codes (hex from MD5 is a subset of A-Z0-9).
DO $$
DECLARE
  r RECORD;
  new_code TEXT;
  suffix INT;
BEGIN
  FOR r IN SELECT id FROM courses ORDER BY created_at LOOP
    suffix := 0;
    LOOP
      new_code := 'C-' || UPPER(SUBSTRING(MD5(r.id::TEXT || ':' || suffix::TEXT) FROM 1 FOR 6));
      IF NOT EXISTS (
        SELECT 1 FROM courses WHERE course_code = new_code AND id <> r.id
      ) THEN
        UPDATE courses SET course_code = new_code WHERE id = r.id;
        EXIT;
      END IF;
      suffix := suffix + 1;
      IF suffix > 100000 THEN
        RAISE EXCEPTION 'Could not assign unique course_code for id %', r.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE courses DROP COLUMN short_code;

ALTER TABLE courses ADD CONSTRAINT courses_course_code_format CHECK (
  course_code ~ '^C-[A-Z0-9]{6}$'
);

CREATE UNIQUE INDEX idx_courses_course_code ON courses(course_code);
