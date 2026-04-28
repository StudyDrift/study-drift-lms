-- Backfill `is_published` for existing active question rows.
UPDATE course.questions
SET is_published = TRUE
WHERE status = 'active'::course.question_status
  AND is_published = FALSE;
