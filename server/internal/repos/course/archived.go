package course

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SetArchived toggles course archived flag and returns updated public row.
func SetArchived(ctx context.Context, pool *pgxpool.Pool, courseCode string, archived bool) (*CoursePublic, error) {
	const q = `
		UPDATE course.courses
		SET archived = $1, updated_at = NOW()
		WHERE course_code = $2
	`
	tag, err := pool.Exec(ctx, q, archived, courseCode)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}
	return GetPublicByCourseCode(ctx, pool, courseCode)
}

