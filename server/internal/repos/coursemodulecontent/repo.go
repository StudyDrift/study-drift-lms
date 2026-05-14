package coursemodulecontent

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CourseItemContentRow struct {
	Title     string
	Markdown  string
	DueAt     *time.Time
	UpdatedAt time.Time
}

func InsertEmptyForItem(ctx context.Context, tx pgx.Tx, structureItemID uuid.UUID) error {
	if tx == nil {
		return errors.New("db tx is nil")
	}
	_, err := tx.Exec(ctx, `
INSERT INTO course.module_content_pages (structure_item_id, markdown, updated_at)
VALUES ($1, '', NOW())
`, structureItemID)
	return err
}

func GetForCourseItem(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) (*CourseItemContentRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var r CourseItemContentRow
	err := pool.QueryRow(ctx, `
SELECT c.title, m.markdown, c.due_at, m.updated_at
FROM course.course_structure_items c
INNER JOIN course.module_content_pages m ON m.structure_item_id = c.id
WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'content_page'
`, itemID, courseID).Scan(&r.Title, &r.Markdown, &r.DueAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// PatchContentPage updates markdown and optionally due_at on the structure row, in one transaction.
func PatchContentPage(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, markdown string, touchDueAt bool, dueAt *time.Time) (*CourseItemContentRow, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
UPDATE course.module_content_pages m
SET markdown = $3, updated_at = NOW()
FROM course.course_structure_items c
WHERE m.structure_item_id = c.id
  AND c.id = $1
  AND c.course_id = $2
  AND c.kind = 'content_page'
`, itemID, courseID, markdown)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, pgx.ErrNoRows
	}
	if touchDueAt {
		tag2, err := tx.Exec(ctx, `
UPDATE course.course_structure_items
SET due_at = $2, updated_at = NOW()
WHERE id = $1 AND course_id = $3 AND kind = 'content_page' AND parent_id IS NOT NULL
`, itemID, dueAt, courseID)
		if err != nil {
			return nil, err
		}
		if tag2.RowsAffected() == 0 {
			return nil, pgx.ErrNoRows
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return GetForCourseItem(ctx, pool, courseID, itemID)
}

func UpdateMarkdown(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, markdown string) (*time.Time, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var updated time.Time
	err := pool.QueryRow(ctx, `
UPDATE course.module_content_pages m
SET markdown = $3, updated_at = NOW()
FROM course.course_structure_items c
WHERE m.structure_item_id = c.id
  AND c.id = $1
  AND c.course_id = $2
  AND c.kind = 'content_page'
RETURNING m.updated_at
`, itemID, courseID, markdown).Scan(&updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

func UpsertImportBody(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, markdown string) error {
	if pool == nil {
		return errors.New("db pool is nil")
	}
	_, err := pool.Exec(ctx, `
INSERT INTO course.module_content_pages (structure_item_id, markdown, updated_at)
SELECT c.id, $3, NOW()
FROM course.course_structure_items c
WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'content_page'
ON CONFLICT (structure_item_id) DO UPDATE
SET markdown = EXCLUDED.markdown, updated_at = NOW()
`, itemID, courseID, markdown)
	return err
}
