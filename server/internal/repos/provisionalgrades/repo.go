package provisionalgrades

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ProvisionalGradeRow struct {
	ID          uuid.UUID
	SubmissionID uuid.UUID
	GraderID    uuid.UUID
	Score       float64
	RubricData  json.RawMessage
	SubmittedAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func ListForAssignment(ctx context.Context, pool *pgxpool.Pool, courseID, moduleItemID uuid.UUID) ([]ProvisionalGradeRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT pg.id, pg.submission_id, pg.grader_id, pg.score, pg.rubric_data, pg.submitted_at, pg.created_at, pg.updated_at
FROM course.provisional_grades pg
INNER JOIN course.module_assignment_submissions s ON s.id = pg.submission_id
WHERE s.course_id = $1 AND s.module_item_id = $2
ORDER BY pg.submission_id, pg.grader_id
`, courseID, moduleItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ProvisionalGradeRow, 0)
	for rows.Next() {
		var r ProvisionalGradeRow
		if err := rows.Scan(&r.ID, &r.SubmissionID, &r.GraderID, &r.Score, &r.RubricData, &r.SubmittedAt, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func ListForSubmission(ctx context.Context, pool *pgxpool.Pool, courseID, submissionID uuid.UUID) ([]ProvisionalGradeRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT pg.id, pg.submission_id, pg.grader_id, pg.score, pg.rubric_data, pg.submitted_at, pg.created_at, pg.updated_at
FROM course.provisional_grades pg
INNER JOIN course.module_assignment_submissions s ON s.id = pg.submission_id
WHERE s.course_id = $1 AND pg.submission_id = $2
ORDER BY pg.grader_id
`, courseID, submissionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ProvisionalGradeRow, 0)
	for rows.Next() {
		var r ProvisionalGradeRow
		if err := rows.Scan(&r.ID, &r.SubmissionID, &r.GraderID, &r.Score, &r.RubricData, &r.SubmittedAt, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func Upsert(ctx context.Context, pool *pgxpool.Pool, submissionID, graderID uuid.UUID, score float64, rubricData json.RawMessage) (*ProvisionalGradeRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	now := time.Now().UTC()
	var r ProvisionalGradeRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.provisional_grades (submission_id, grader_id, score, rubric_data, submitted_at, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $5, $5)
ON CONFLICT (submission_id, grader_id) DO UPDATE SET
	score = EXCLUDED.score,
	rubric_data = EXCLUDED.rubric_data,
	submitted_at = EXCLUDED.submitted_at,
	updated_at = EXCLUDED.updated_at
RETURNING id, submission_id, grader_id, score, rubric_data, submitted_at, created_at, updated_at
`, submissionID, graderID, score, rubricData, now).Scan(
		&r.ID, &r.SubmissionID, &r.GraderID, &r.Score, &r.RubricData, &r.SubmittedAt, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
