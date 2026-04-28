package srs

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ReviewQueueRow struct {
	UserID       uuid.UUID
	QuestionID   uuid.UUID
	DueAt        time.Time
	Easiness     float64
	IntervalDays int32
}

func CountDueForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint
FROM course.srs_states
WHERE user_id = $1 AND due_at <= NOW()
`, userID).Scan(&n)
	return n, err
}

func ListReviewQueue(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, limit int64) ([]ReviewQueueRow, error) {
	rows, err := pool.Query(ctx, `
SELECT user_id, question_id, due_at, (easiness)::float8, interval_days
FROM course.srs_states
WHERE user_id = $1 AND due_at <= NOW()
ORDER BY due_at ASC
LIMIT $2
`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ReviewQueueRow, 0)
	for rows.Next() {
		var r ReviewQueueRow
		if err := rows.Scan(&r.UserID, &r.QuestionID, &r.DueAt, &r.Easiness, &r.IntervalDays); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func InsertReviewEvent(ctx context.Context, pool *pgxpool.Pool, userID, questionID uuid.UUID, quality int16) error {
	_, err := pool.Exec(ctx, `
INSERT INTO course.srs_review_events (user_id, question_id, quality)
VALUES ($1, $2, $3)
`, userID, questionID, quality)
	return err
}
