// Package course is a minimal port of server/src/repos/course.rs (lookups by code / id).
package course

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GetIDByCourseCode returns the course id or nil.
func GetIDByCourseCode(ctx context.Context, pool *pgxpool.Pool, courseCode string) (*uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `SELECT id FROM course.courses WHERE course_code = $1`, courseCode).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// GetCourseCodeByID returns the course code or nil.
func GetCourseCodeByID(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (*string, error) {
	var code string
	err := pool.QueryRow(ctx, `SELECT course_code FROM course.courses WHERE id = $1`, courseID).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &code, nil
}

// GetImportFlags returns question bank + QTI import flags for a course id.
func GetImportFlags(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (questionBankEnabled, qtiImportEnabled bool, err error) {
	e := pool.QueryRow(ctx, `
SELECT question_bank_enabled, qti_import_enabled FROM course.courses WHERE id = $1
`, courseID).Scan(&questionBankEnabled, &qtiImportEnabled)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, false, nil
	}
	return questionBankEnabled, qtiImportEnabled, e
}
