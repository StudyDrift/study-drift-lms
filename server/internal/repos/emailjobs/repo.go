package emailjobs

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Job is a queued outbound email.
type Job struct {
	ID            uuid.UUID
	RecipientID   uuid.UUID
	EventType     string
	Subject       string
	Template      string
	TemplateVars  map[string]string
	Status        string
	Attempts      int
	NextRetryAt   *time.Time
	CreatedAt     time.Time
	SentAt        *time.Time
}

// Enqueue inserts a pending email job.
func Enqueue(ctx context.Context, pool *pgxpool.Pool, recipientID uuid.UUID, eventType, subject, template string, vars map[string]string) (uuid.UUID, error) {
	if vars == nil {
		vars = map[string]string{}
	}
	raw, err := json.Marshal(vars)
	if err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err = pool.QueryRow(ctx, `
INSERT INTO settings.email_jobs (recipient_id, event_type, subject, template, template_vars)
VALUES ($1, $2, $3, $4, $5::jsonb)
RETURNING id
`, recipientID, eventType, subject, template, raw).Scan(&id)
	return id, err
}

func scanJobs(rows pgx.Rows) ([]Job, error) {
	var out []Job
	for rows.Next() {
		var j Job
		var raw []byte
		if err := rows.Scan(&j.ID, &j.RecipientID, &j.EventType, &j.Subject, &j.Template, &raw,
			&j.Status, &j.Attempts, &j.NextRetryAt, &j.CreatedAt, &j.SentAt); err != nil {
			return nil, err
		}
		j.TemplateVars = map[string]string{}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &j.TemplateVars)
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// ListDue returns jobs ready to process without locking (read-only peek).
func ListDue(ctx context.Context, pool *pgxpool.Pool, limit int, now time.Time) ([]Job, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
SELECT id, recipient_id, event_type, subject, template, template_vars, status, attempts, next_retry_at, created_at, sent_at
FROM settings.email_jobs
WHERE status IN ('pending', 'failed')
  AND (next_retry_at IS NULL OR next_retry_at <= $1)
ORDER BY created_at
LIMIT $2
`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJobs(rows)
}

// MarkSent marks a job delivered.
func MarkSent(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID, at time.Time) error {
	_, err := pool.Exec(ctx, `
UPDATE settings.email_jobs SET status = 'sent', sent_at = $2, next_retry_at = NULL WHERE id = $1
`, jobID, at)
	return err
}

// MarkRetry schedules retry or dead-letter after max attempts.
func MarkRetry(ctx context.Context, pool *pgxpool.Pool, jobID uuid.UUID, attempts int, nextRetry time.Time, dead bool) error {
	status := "failed"
	if dead {
		status = "dead"
	}
	_, err := pool.Exec(ctx, `
UPDATE settings.email_jobs
SET status = $2, attempts = $3, next_retry_at = $4
WHERE id = $1
`, jobID, status, attempts, nextRetry)
	return err
}
