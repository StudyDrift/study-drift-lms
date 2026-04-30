package quizattempts

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AttemptSweepRow is the subset of quiz_attempts needed for auto-submit sweeps.
type AttemptSweepRow struct {
	ID              uuid.UUID
	CourseID        uuid.UUID
	StructureItemID uuid.UUID
	StudentUserID   uuid.UUID
	Status          string
	IsAdaptive      bool
}

// ListExpiredInProgressAttemptIDs returns in-progress attempts whose deadline has passed.
func ListExpiredInProgressAttemptIDs(ctx context.Context, pool *pgxpool.Pool, now time.Time, limit int64) ([]uuid.UUID, error) {
	if limit < 1 {
		limit = 1
	}
	rows, err := pool.Query(ctx, `
SELECT id
FROM course.quiz_attempts
WHERE status = 'in_progress'
  AND deadline_at IS NOT NULL
  AND deadline_at <= $1
ORDER BY deadline_at ASC
LIMIT $2
`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GetAttemptForSweep loads fields needed by the auto-submit job.
func GetAttemptForSweep(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID) (*AttemptSweepRow, error) {
	var r AttemptSweepRow
	err := pool.QueryRow(ctx, `
SELECT id, course_id, structure_item_id, student_user_id, status, is_adaptive
FROM course.quiz_attempts
WHERE id = $1
`, attemptID).Scan(&r.ID, &r.CourseID, &r.StructureItemID, &r.StudentUserID, &r.Status, &r.IsAdaptive)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// SumResponsePointsForAttempt returns (earned, possible) from quiz_responses.
func SumResponsePointsForAttempt(ctx context.Context, tx pgx.Tx, attemptID uuid.UUID) (earned, possible float64, err error) {
	err = tx.QueryRow(ctx, `
SELECT COALESCE(SUM(points_awarded), 0)::float8,
       COALESCE(SUM(max_points), 0)::float8
FROM course.quiz_responses
WHERE attempt_id = $1
`, attemptID).Scan(&earned, &possible)
	return earned, possible, err
}

// FinalizeAttemptAutoSubmitted marks the attempt submitted when still in_progress past deadline.
func FinalizeAttemptAutoSubmitted(ctx context.Context, tx pgx.Tx, attemptID uuid.UUID, submittedAt time.Time, pointsEarned, pointsPossible float64, scorePercent float32) (bool, error) {
	tag, err := tx.Exec(ctx, `
UPDATE course.quiz_attempts
SET status = 'submitted',
    submitted_at = $2,
    points_earned = $3,
    points_possible = $4,
    score_percent = $5,
    auto_submitted = TRUE
WHERE id = $1
  AND status = 'in_progress'
  AND deadline_at IS NOT NULL
  AND deadline_at <= $2
`, attemptID, submittedAt, pointsEarned, pointsPossible, scorePercent)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
