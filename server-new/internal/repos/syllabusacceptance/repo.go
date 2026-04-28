package syllabusacceptance

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func HasAccepted(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	var count int64
	if err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint
FROM course.syllabus_acceptances
WHERE user_id = $1 AND course_id = $2
`, userID, courseID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func Record(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID) error {
	if pool == nil {
		return errors.New("db pool is nil")
	}
	_, err := pool.Exec(ctx, `
INSERT INTO course.syllabus_acceptances (user_id, course_id, accepted_at)
VALUES ($1, $2, NOW())
ON CONFLICT (user_id, course_id) DO NOTHING
`, userID, courseID)
	return err
}
