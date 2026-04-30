package hints

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type QuestionHintRow struct {
	ID         uuid.UUID
	QuestionID uuid.UUID
	Level      int16
	Body       string
	MediaURL   *string
	Locale     string
	PenaltyPct float64
	CreatedAt  time.Time
}

type WorkedExampleRow struct {
	ID         uuid.UUID
	QuestionID uuid.UUID
	Title      *string
	Body       *string
	Steps      json.RawMessage
	CreatedAt  time.Time
}

func ListHintsForQuestionLocale(ctx context.Context, pool *pgxpool.Pool, questionID uuid.UUID, locale string) ([]QuestionHintRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, question_id, level, body, media_url, locale, (penalty_pct)::float8, created_at
FROM course.question_hints
WHERE question_id = $1 AND locale = $2
ORDER BY level ASC
`, questionID, locale)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]QuestionHintRow, 0)
	for rows.Next() {
		var r QuestionHintRow
		if err := rows.Scan(&r.ID, &r.QuestionID, &r.Level, &r.Body, &r.MediaURL, &r.Locale, &r.PenaltyPct, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func InsertHint(ctx context.Context, pool *pgxpool.Pool, questionID uuid.UUID, level int16, body string, mediaURL *string, locale string, penaltyPct float64) (*QuestionHintRow, error) {
	var r QuestionHintRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.question_hints (question_id, level, body, media_url, locale, penalty_pct)
VALUES ($1,$2,$3,$4,$5,$6)
RETURNING id, question_id, level, body, media_url, locale, (penalty_pct)::float8, created_at
`, questionID, level, body, mediaURL, locale, penaltyPct).Scan(&r.ID, &r.QuestionID, &r.Level, &r.Body, &r.MediaURL, &r.Locale, &r.PenaltyPct, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func GetWorkedExample(ctx context.Context, pool *pgxpool.Pool, questionID uuid.UUID) (*WorkedExampleRow, error) {
	var r WorkedExampleRow
	err := pool.QueryRow(ctx, `
SELECT id, question_id, title, body, steps, created_at
FROM course.question_worked_examples
WHERE question_id = $1
`, questionID).Scan(&r.ID, &r.QuestionID, &r.Title, &r.Body, &r.Steps, &r.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func UpsertWorkedExample(ctx context.Context, pool *pgxpool.Pool, questionID uuid.UUID, title, body *string, steps json.RawMessage) (*WorkedExampleRow, error) {
	var r WorkedExampleRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.question_worked_examples (question_id, title, body, steps)
VALUES ($1, $2, $3, $4)
ON CONFLICT (question_id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, steps = EXCLUDED.steps
RETURNING id, question_id, title, body, steps, created_at
`, questionID, title, body, steps).Scan(&r.ID, &r.QuestionID, &r.Title, &r.Body, &r.Steps, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
