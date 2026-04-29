package srs

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ReviewQueueItemRow is one due row for GET /learners/{id}/review-queue (matches Rust srs_repo::SrsReviewQueueRow).
type ReviewQueueItemRow struct {
	StateID       uuid.UUID
	QuestionID    uuid.UUID
	CourseID      uuid.UUID
	CourseCode    string
	CourseTitle   string
	NextReviewAt  time.Time
	Stem          string
	QuestionType  string
	Options       []byte
	CorrectAnswer []byte
	Explanation   *string
}

func CountDueForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint
FROM course.srs_item_states s
INNER JOIN course.questions q ON q.id = s.question_id
INNER JOIN course.courses c ON c.id = q.course_id
INNER JOIN course.course_enrollments e ON e.course_id = q.course_id AND e.user_id = s.user_id AND e.active
WHERE s.user_id = $1
  AND c.srs_enabled = TRUE
  AND q.srs_eligible = TRUE
  AND s.next_review_at <= NOW()
  AND (s.suppressed_until IS NULL OR s.suppressed_until < NOW())
`, userID).Scan(&n)
	return n, err
}

func ListReviewQueue(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, limit, offset int64) ([]ReviewQueueItemRow, error) {
	rows, err := pool.Query(ctx, `
SELECT
    s.id AS state_id,
    s.question_id,
    q.course_id,
    c.course_code,
    c.title AS course_title,
    s.next_review_at,
    q.stem,
    q.question_type::text AS question_type,
    q.options,
    q.correct_answer,
    q.explanation
FROM course.srs_item_states s
INNER JOIN course.questions q ON q.id = s.question_id
INNER JOIN course.courses c ON c.id = q.course_id
INNER JOIN course.course_enrollments e ON e.course_id = q.course_id AND e.user_id = s.user_id AND e.active
WHERE s.user_id = $1
  AND c.srs_enabled = TRUE
  AND q.srs_eligible = TRUE
  AND s.next_review_at <= NOW()
  AND (s.suppressed_until IS NULL OR s.suppressed_until < NOW())
ORDER BY s.next_review_at ASC, s.question_id ASC
LIMIT $2 OFFSET $3
`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ReviewQueueItemRow, 0)
	for rows.Next() {
		var r ReviewQueueItemRow
		if err := rows.Scan(
			&r.StateID,
			&r.QuestionID,
			&r.CourseID,
			&r.CourseCode,
			&r.CourseTitle,
			&r.NextReviewAt,
			&r.Stem,
			&r.QuestionType,
			&r.Options,
			&r.CorrectAnswer,
			&r.Explanation,
		); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
