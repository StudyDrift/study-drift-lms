package enrollment

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UserIsCourseCreator is true when the user created the course (Rust `user_is_course_creator`).
func UserIsCourseCreator(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM course.courses c
			WHERE c.course_code = $1 AND c.created_by_user_id = $2
		)
	`, courseCode, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}
