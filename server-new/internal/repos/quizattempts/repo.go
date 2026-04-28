package quizattempts

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type QuizAttemptRow struct {
	ID                   uuid.UUID
	CourseID             uuid.UUID
	StructureItemID      uuid.UUID
	StudentUserID        uuid.UUID
	Status               string
	AttemptNumber        int32
	StartedAt            time.Time
	SubmittedAt          *time.Time
	CurrentQuestionIndex int32
}

func GetAttempt(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID) (*QuizAttemptRow, error) {
	var r QuizAttemptRow
	err := pool.QueryRow(ctx, `
SELECT id, course_id, structure_item_id, student_user_id, status, attempt_number, started_at, submitted_at, current_question_index
FROM course.quiz_attempts
WHERE id = $1
`, attemptID).Scan(&r.ID, &r.CourseID, &r.StructureItemID, &r.StudentUserID, &r.Status, &r.AttemptNumber, &r.StartedAt, &r.SubmittedAt, &r.CurrentQuestionIndex)
	if err != nil {
		return nil, nil
	}
	return &r, nil
}

func CountSubmittedAttempts(ctx context.Context, pool *pgxpool.Pool, courseID, structureItemID, studentUserID uuid.UUID) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint
FROM course.quiz_attempts
WHERE course_id = $1 AND structure_item_id = $2 AND student_user_id = $3 AND status = 'submitted'
`, courseID, structureItemID, studentUserID).Scan(&n)
	return n, err
}

func InsertFocusLossEvent(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID, eventType string, durationMS *int32) error {
	_, err := pool.Exec(ctx, `
INSERT INTO course.quiz_focus_loss_events (attempt_id, event_type, duration_ms)
VALUES ($1, $2, $3)
`, attemptID, eventType, durationMS)
	return err
}
