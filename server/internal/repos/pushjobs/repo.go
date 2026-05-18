package pushjobs

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Job is one pending push delivery job.
type Job struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	NotificationID *uuid.UUID
	Title          string
	Body           string
	ActionURL      string
	Attempts       int
}

// Enqueue inserts a new push delivery job.
func Enqueue(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, notifID *uuid.UUID, title, body, actionURL string) error {
	_, err := pool.Exec(ctx, `
INSERT INTO settings.push_jobs (user_id, notification_id, title, body, action_url)
VALUES ($1, $2, $3, $4, NULLIF($5,''))
`, userID, notifID, title, body, actionURL)
	return err
}

// ListDue returns up to limit pending/retryable jobs with next_retry_at <= now.
func ListDue(ctx context.Context, pool *pgxpool.Pool, limit int, now time.Time) ([]Job, error) {
	rows, err := pool.Query(ctx, `
SELECT id, user_id, notification_id, title, body, COALESCE(action_url,''), attempts
FROM settings.push_jobs
WHERE status IN ('pending','failed')
  AND (next_retry_at IS NULL OR next_retry_at <= $1)
ORDER BY created_at
LIMIT $2
FOR UPDATE SKIP LOCKED
`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Job
	for rows.Next() {
		var j Job
		if err := rows.Scan(&j.ID, &j.UserID, &j.NotificationID, &j.Title, &j.Body, &j.ActionURL, &j.Attempts); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// MarkSent marks a job as successfully delivered.
func MarkSent(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, now time.Time) error {
	_, err := pool.Exec(ctx, `UPDATE settings.push_jobs SET status='sent', sent_at=$1 WHERE id=$2`, now, id)
	return err
}

// MarkRetry schedules a retry or dead-letters the job.
func MarkRetry(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, attempts int, next time.Time, dead bool) error {
	status := "failed"
	if dead {
		status = "dead"
	}
	_, err := pool.Exec(ctx, `
UPDATE settings.push_jobs SET status=$1, attempts=$2, next_retry_at=NULLIF($3::timestamptz, '0001-01-01'::timestamptz)
WHERE id=$4
`, status, attempts, next, id)
	return err
}
