package enrollment

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ByID is a roster row joined to its course code (server/src/repos/enrollment.rs EnrollmentById).
type ByID struct {
	ID         uuid.UUID
	CourseID   uuid.UUID
	CourseCode string
	UserID     uuid.UUID
	Role       string
}

// GetByID returns one enrollment or nil.
func GetByID(ctx context.Context, pool *pgxpool.Pool, enrollmentID uuid.UUID) (*ByID, error) {
	const q = `
SELECT ce.id, ce.course_id, c.course_code, ce.user_id, ce.role
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE ce.id = $1`
	var r ByID
	err := pool.QueryRow(ctx, q, enrollmentID).Scan(
		&r.ID, &r.CourseID, &r.CourseCode, &r.UserID, &r.Role,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}
