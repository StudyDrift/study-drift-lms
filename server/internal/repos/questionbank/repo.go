package questionbank

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type QuestionRow struct {
	ID           uuid.UUID
	CourseID     uuid.UUID
	QuestionType string
	Stem         string
	Options      json.RawMessage
	CorrectAnswer json.RawMessage
	Explanation  *string
	Points       float64
	Status       string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func CourseHasQuestionBank(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (bool, error) {
	var enabled bool
	err := pool.QueryRow(ctx, `
SELECT question_bank_enabled
FROM course.courses
WHERE id = $1
`, courseID).Scan(&enabled)
	return enabled, err
}

func GetQuestion(ctx context.Context, pool *pgxpool.Pool, questionID uuid.UUID) (*QuestionRow, error) {
	var r QuestionRow
	err := pool.QueryRow(ctx, `
SELECT id, course_id, question_type, stem, options, correct_answer, explanation, points, status, created_at, updated_at
FROM course.questions
WHERE id = $1
`, questionID).Scan(&r.ID, &r.CourseID, &r.QuestionType, &r.Stem, &r.Options, &r.CorrectAnswer, &r.Explanation, &r.Points, &r.Status, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, nil
	}
	return &r, nil
}

func InsertQuestion(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, questionType, stem string, options, correctAnswer json.RawMessage, explanation *string, points float64, status string) (*QuestionRow, error) {
	var r QuestionRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.questions (course_id, question_type, stem, options, correct_answer, explanation, points, status)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
RETURNING id, course_id, question_type, stem, options, correct_answer, explanation, points, status, created_at, updated_at
`, courseID, questionType, stem, options, correctAnswer, explanation, points, status).Scan(
		&r.ID, &r.CourseID, &r.QuestionType, &r.Stem, &r.Options, &r.CorrectAnswer, &r.Explanation, &r.Points, &r.Status, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
