package course

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SetTermID sets nullable term_id on a course by course_code (nil clears).
func SetTermID(ctx context.Context, pool *pgxpool.Pool, courseCode string, termID *uuid.UUID) (*CoursePublic, error) {
	tag, err := pool.Exec(ctx, `
UPDATE course.courses SET term_id = $2, updated_at = NOW() WHERE course_code = $1
`, courseCode, termID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}
	return GetPublicByCourseCode(ctx, pool, courseCode)
}

// CourseOrgID returns org_id for a course code or nil if missing.
func CourseOrgID(ctx context.Context, pool *pgxpool.Pool, courseCode string) (*uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `SELECT org_id FROM course.courses WHERE course_code = $1`, courseCode).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}
