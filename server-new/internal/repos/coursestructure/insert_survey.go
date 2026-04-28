package coursestructure

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/repos/coursemodulesurveys"
)

// InsertSurveyUnderModule appends a survey item under an existing module and creates an empty module_surveys row.
func InsertSurveyUnderModule(ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID, title string) (uuid.UUID, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var courseRow uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM course.courses WHERE id = $1 FOR UPDATE`, courseID).Scan(&courseRow)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, pgx.ErrNoRows
	}
	if err != nil {
		return uuid.UUID{}, err
	}
	var parentOK bool
	if err := tx.QueryRow(ctx, `
SELECT EXISTS(
	SELECT 1 FROM course.course_structure_items
	WHERE id = $1 AND course_id = $2 AND kind = 'module'
)
`, moduleID, courseID).Scan(&parentOK); err != nil {
		return uuid.UUID{}, err
	}
	if !parentOK {
		return uuid.UUID{}, pgx.ErrNoRows
	}
	itemID := uuid.New()
	err = tx.QueryRow(ctx, `
WITH mx AS (
	SELECT COALESCE(MAX(sort_order), -1) AS max_ord
	FROM course.course_structure_items
	WHERE parent_id = $1
)
INSERT INTO course.course_structure_items (id, course_id, sort_order, kind, title, parent_id)
SELECT $2, $3, max_ord + 1, 'survey', $4, $1
FROM mx
RETURNING id
`, moduleID, itemID, courseID, title).Scan(&itemID)
	if err != nil {
		return uuid.UUID{}, err
	}
	if err := coursemodulesurveys.InsertEmptyForItem(ctx, tx, itemID); err != nil {
		return uuid.UUID{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.UUID{}, err
	}
	return itemID, nil
}
