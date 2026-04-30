package concepts

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ValidateConceptIDsForCourse ensures every id belongs to the course or is tied via question tags (Rust `validate_concepts_for_course`).
func ValidateConceptIDsForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, conceptIDs []uuid.UUID) error {
	if len(conceptIDs) == 0 {
		return fmt.Errorf("conceptIds must be non-empty")
	}
	rows, err := pool.Query(ctx, `
SELECT c.id
FROM course.concepts c
WHERE c.id = ANY($1)
  AND (
    c.course_id = $2
    OR EXISTS (
      SELECT 1
      FROM course.concept_question_tags t
      INNER JOIN course.questions q ON q.id = t.question_id
      WHERE t.concept_id = c.id AND q.course_id = $2
    )
  )
`, conceptIDs, courseID)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := make(map[uuid.UUID]struct{}, len(conceptIDs))
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return err
		}
		found[id] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(found) != len(conceptIDs) {
		return fmt.Errorf("one or more conceptIds are unknown or not usable in this course")
	}
	return nil
}
