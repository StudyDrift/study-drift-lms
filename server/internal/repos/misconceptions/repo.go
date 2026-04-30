package misconceptions

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MisconceptionRow struct {
	ID              uuid.UUID
	CourseID        uuid.UUID
	ConceptID       *uuid.UUID
	Name            string
	Description     *string
	RemediationBody *string
	RemediationURL  *string
	Locale          string
	IsSeed          bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type QuestionOptionMisconceptionTagRow struct {
	OptionID        uuid.UUID
	MisconceptionID uuid.UUID
}

func ListOptionTagsForQuestion(ctx context.Context, pool *pgxpool.Pool, questionID uuid.UUID) ([]QuestionOptionMisconceptionTagRow, error) {
	rows, err := pool.Query(ctx, `
SELECT option_id, misconception_id
FROM course.question_option_misconception_tags
WHERE question_id = $1
ORDER BY option_id
`, questionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]QuestionOptionMisconceptionTagRow, 0)
	for rows.Next() {
		var r QuestionOptionMisconceptionTagRow
		if err := rows.Scan(&r.OptionID, &r.MisconceptionID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func ListForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, limit int64) ([]MisconceptionRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, course_id, concept_id, name, description, remediation_body, remediation_url, locale, is_seed, created_at, updated_at
FROM course.misconceptions
WHERE course_id = $1
ORDER BY name ASC
LIMIT $2
`, courseID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]MisconceptionRow, 0)
	for rows.Next() {
		var r MisconceptionRow
		if err := rows.Scan(&r.ID, &r.CourseID, &r.ConceptID, &r.Name, &r.Description, &r.RemediationBody, &r.RemediationURL, &r.Locale, &r.IsSeed, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func DeleteSeedMisconceptionsForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (uint64, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM course.misconceptions WHERE course_id = $1 AND is_seed = TRUE`, courseID)
	if err != nil {
		return 0, err
	}
	return uint64(tag.RowsAffected()), nil
}

// MisconceptionSummaryRow is one recurring misconception for a learner in a course.
type MisconceptionSummaryRow struct {
	MisconceptionID uuid.UUID
	Name            string
	TriggerCount    int64
}

// ListRecurringForUserCourse returns misconceptions the learner triggered at least minTriggers times.
func ListRecurringForUserCourse(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID, minTriggers int64) ([]MisconceptionSummaryRow, error) {
	rows, err := pool.Query(ctx, `
SELECT m.id AS misconception_id, m.name, COUNT(*)::bigint AS trigger_count
FROM course.misconception_events e
INNER JOIN course.misconceptions m ON m.id = e.misconception_id
WHERE e.user_id = $1 AND e.course_id = $2
GROUP BY m.id, m.name
HAVING COUNT(*) >= $3
ORDER BY trigger_count DESC
`, userID, courseID, minTriggers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MisconceptionSummaryRow
	for rows.Next() {
		var r MisconceptionSummaryRow
		if err := rows.Scan(&r.MisconceptionID, &r.Name, &r.TriggerCount); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func CountAllEventsForUserCourse(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint FROM course.misconception_events WHERE user_id = $1 AND course_id = $2
`, userID, courseID).Scan(&n)
	return n, err
}
