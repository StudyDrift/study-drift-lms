package course

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CourseQuizMeta holds flags used when building quiz API payloads.
type CourseQuizMeta struct {
	QuestionBankEnabled           bool
	LockdownModeEnabled           bool
	HintScaffoldingEnabled        bool
	MisconceptionDetectionEnabled bool
}

// GetCourseQuizMeta loads delivery-related course flags by primary key.
func GetCourseQuizMeta(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (*CourseQuizMeta, error) {
	var m CourseQuizMeta
	err := pool.QueryRow(ctx, `
SELECT question_bank_enabled, lockdown_mode_enabled, hint_scaffolding_enabled, misconception_detection_enabled
FROM course.courses WHERE id = $1
`, courseID).Scan(
		&m.QuestionBankEnabled,
		&m.LockdownModeEnabled,
		&m.HintScaffoldingEnabled,
		&m.MisconceptionDetectionEnabled,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}
