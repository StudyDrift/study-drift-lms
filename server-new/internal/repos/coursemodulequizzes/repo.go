package coursemodulequizzes

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
)

type QuizRow struct {
	StructureItemID uuid.UUID
	Markdown        string
	UpdatedAt       time.Time
	PointsWorth     *int32
	IsAdaptive      bool
	Questions       []coursemodulequiz.QuizQuestion
}

func InsertEmptyForItem(ctx context.Context, tx pgx.Tx, structureItemID uuid.UUID) error {
	if tx == nil {
		return errors.New("db tx is nil")
	}
	_, err := tx.Exec(ctx, `
INSERT INTO course.module_quizzes (structure_item_id, markdown, updated_at)
VALUES ($1, '', NOW())
`, structureItemID)
	return err
}

func GetForCourseItem(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) (*QuizRow, error) {
	var r QuizRow
	var questionsJSON []byte
	err := pool.QueryRow(ctx, `
SELECT q.structure_item_id, q.markdown, q.updated_at, q.points_worth, q.is_adaptive, q.questions_json
FROM course.module_quizzes q
INNER JOIN course.course_structure_items c ON c.id = q.structure_item_id
WHERE c.course_id = $1 AND c.id = $2 AND c.kind = 'quiz'
`, courseID, itemID).Scan(&r.StructureItemID, &r.Markdown, &r.UpdatedAt, &r.PointsWorth, &r.IsAdaptive, &questionsJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(questionsJSON) > 0 {
		_ = json.Unmarshal(questionsJSON, &r.Questions)
	}
	return &r, nil
}

func UpdateMarkdown(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, markdown string) (*time.Time, error) {
	var updated time.Time
	err := pool.QueryRow(ctx, `
UPDATE course.module_quizzes q
SET markdown = $3, updated_at = NOW()
FROM course.course_structure_items c
WHERE q.structure_item_id = c.id AND c.course_id = $1 AND c.id = $2 AND c.kind = 'quiz'
RETURNING q.updated_at
`, courseID, itemID, markdown).Scan(&updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &updated, nil
}
