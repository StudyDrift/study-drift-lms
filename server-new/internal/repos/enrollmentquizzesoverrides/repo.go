package enrollmentquizzesoverrides

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type EnrollmentQuizOverrideWrite struct {
	ExtraAttempts  int32
	TimeMultiplier *float64
}

func GetExtraAttemptsForEnrollmentQuiz(ctx context.Context, pool *pgxpool.Pool, enrollmentID, quizStructureItemID uuid.UUID) (int32, error) {
	if pool == nil {
		return 0, errors.New("db pool is nil")
	}
	var n *int32
	if err := pool.QueryRow(ctx, `
SELECT extra_attempts
FROM course.enrollment_quiz_overrides
WHERE enrollment_id = $1 AND quiz_id = $2
`, enrollmentID, quizStructureItemID).Scan(&n); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	if n == nil || *n < 0 {
		return 0, nil
	}
	return *n, nil
}

func UpsertOverride(ctx context.Context, pool *pgxpool.Pool, enrollmentID, quizStructureItemID, createdBy uuid.UUID, w *EnrollmentQuizOverrideWrite) error {
	if pool == nil {
		return errors.New("db pool is nil")
	}
	if w == nil {
		return errors.New("override payload is nil")
	}
	extra := w.ExtraAttempts
	if extra < 0 {
		extra = 0
	}
	_, err := pool.Exec(ctx, `
INSERT INTO course.enrollment_quiz_overrides (enrollment_id, quiz_id, extra_attempts, time_multiplier, created_by)
VALUES ($1, $2, $3, $4::numeric, $5)
ON CONFLICT (enrollment_id, quiz_id) DO UPDATE SET
    extra_attempts = EXCLUDED.extra_attempts,
    time_multiplier = EXCLUDED.time_multiplier,
    created_by = EXCLUDED.created_by
`, enrollmentID, quizStructureItemID, extra, w.TimeMultiplier, createdBy)
	return err
}

func DeleteOverride(ctx context.Context, pool *pgxpool.Pool, enrollmentID, quizStructureItemID uuid.UUID) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	tag, err := pool.Exec(ctx, `
DELETE FROM course.enrollment_quiz_overrides
WHERE enrollment_id = $1 AND quiz_id = $2
`, enrollmentID, quizStructureItemID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
