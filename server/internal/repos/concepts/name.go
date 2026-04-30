package concepts

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NameInCourse returns a concept display name for diagnostics (Rust `concept_name`).
func NameInCourse(ctx context.Context, pool *pgxpool.Pool, courseID, conceptID uuid.UUID) (string, error) {
	var name string
	err := pool.QueryRow(ctx, `
SELECT name FROM course.concepts
WHERE id = $1 AND (course_id = $2 OR course_id IS NULL)
`, conceptID, courseID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "Concept", nil
	}
	if err != nil {
		return "", err
	}
	return name, nil
}
