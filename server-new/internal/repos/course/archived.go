package course

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SetArchived toggles course archived flag and returns updated public row.
func SetArchived(ctx context.Context, pool *pgxpool.Pool, courseCode string, archived bool) (*CoursePublic, error) {
	const q = `
		UPDATE course.courses
		SET archived = $1, updated_at = NOW()
		WHERE course_code = $2
		RETURNING` + publicReturningColumns

	row := pool.QueryRow(ctx, q, archived, courseCode)
	out, err := scanCoursePublicFromRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

