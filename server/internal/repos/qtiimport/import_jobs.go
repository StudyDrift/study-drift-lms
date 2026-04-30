package qtiimport

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ImportJobRow matches course.import_jobs (migration 101).
type ImportJobRow struct {
	ID               uuid.UUID
	CourseID         uuid.UUID
	ImportType       string
	OriginalFilename string
	Status           string
	TotalItems       *int32
	ProcessedItems   int32
	SucceededItems   int32
	FailedItems      int32
	SkippedItems     int32
	ErrorLog         json.RawMessage
	StartedAt        *time.Time
	CompletedAt      *time.Time
	CreatedBy        uuid.UUID
	CreatedAt        time.Time
}

func InsertImportJob(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, importType, originalFilename string, createdBy uuid.UUID) (*ImportJobRow, error) {
	var r ImportJobRow
	var errLog []byte
	err := pool.QueryRow(ctx, `
INSERT INTO course.import_jobs (course_id, import_type, original_filename, status, created_by)
VALUES ($1, $2, $3, 'pending', $4)
RETURNING
	id, course_id, import_type, original_filename, status, total_items, processed_items,
	succeeded_items, failed_items, skipped_items, error_log, started_at, completed_at, created_by, created_at
`, courseID, importType, originalFilename, createdBy).Scan(
		&r.ID, &r.CourseID, &r.ImportType, &r.OriginalFilename, &r.Status, &r.TotalItems, &r.ProcessedItems,
		&r.SucceededItems, &r.FailedItems, &r.SkippedItems, &errLog, &r.StartedAt, &r.CompletedAt, &r.CreatedBy, &r.CreatedAt,
	)
	if len(errLog) > 0 {
		r.ErrorLog = errLog
	} else {
		r.ErrorLog = []byte(`[]`)
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func GetImportJob(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID) (*ImportJobRow, error) {
	var r ImportJobRow
	var errLog []byte
	err := pool.QueryRow(ctx, `
SELECT
	id, course_id, import_type, original_filename, status, total_items, processed_items,
	succeeded_items, failed_items, skipped_items, error_log, started_at, completed_at, created_by, created_at
FROM course.import_jobs
WHERE id = $1
`, jobID).Scan(
		&r.ID, &r.CourseID, &r.ImportType, &r.OriginalFilename, &r.Status, &r.TotalItems, &r.ProcessedItems,
		&r.SucceededItems, &r.FailedItems, &r.SkippedItems, &errLog, &r.StartedAt, &r.CompletedAt, &r.CreatedBy, &r.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(errLog) > 0 {
		r.ErrorLog = errLog
	} else {
		r.ErrorLog = []byte(`[]`)
	}
	return &r, nil
}

func ListImportJobsForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, courseID *uuid.UUID, limit int64) ([]ImportJobRow, error) {
	q := `
SELECT
	id, course_id, import_type, original_filename, status, total_items, processed_items,
	succeeded_items, failed_items, skipped_items, error_log, started_at, completed_at, created_by, created_at
FROM course.import_jobs
WHERE created_by = $1
  AND ($2::uuid IS NULL OR course_id = $2)
ORDER BY created_at DESC
LIMIT $3`
	rows, err := pool.Query(ctx, q, userID, courseID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ImportJobRow, 0)
	for rows.Next() {
		var r ImportJobRow
		var errLog []byte
		if err := rows.Scan(
			&r.ID, &r.CourseID, &r.ImportType, &r.OriginalFilename, &r.Status, &r.TotalItems, &r.ProcessedItems,
			&r.SucceededItems, &r.FailedItems, &r.SkippedItems, &errLog, &r.StartedAt, &r.CompletedAt, &r.CreatedBy, &r.CreatedAt,
		); err != nil {
			return nil, err
		}
		if len(errLog) > 0 {
			r.ErrorLog = errLog
		} else {
			r.ErrorLog = []byte(`[]`)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func MarkJobRunning(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
UPDATE course.import_jobs SET status = 'running', started_at = COALESCE(started_at, NOW()), completed_at = NULL WHERE id = $1
`, jobID)
	return err
}

func MarkJobDone(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID, processed, succeeded, failed, skipped int32, errLog json.RawMessage) error {
	if errLog == nil {
		errLog = []byte(`[]`)
	}
	_, err := pool.Exec(ctx, `
UPDATE course.import_jobs
SET status = 'done',
	processed_items = $2,
	succeeded_items = $3,
	failed_items = $4,
	skipped_items = $5,
	error_log = $6,
	completed_at = NOW()
WHERE id = $1
`, jobID, processed, succeeded, failed, skipped, errLog)
	return err
}
