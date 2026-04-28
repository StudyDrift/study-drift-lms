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
