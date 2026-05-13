package coursestructure

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// insertModuleChild inserts a structure row under an existing module and runs extraDDL in the same transaction.
func insertModuleChild(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID, moduleID uuid.UUID,
	kind, title string,
	extra func(pgx.Tx, uuid.UUID) error,
) (ItemRow, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return ItemRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var courseRow uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM course.courses WHERE id = $1 FOR UPDATE`, courseID).Scan(&courseRow)
	if errors.Is(err, pgx.ErrNoRows) {
		return ItemRow{}, pgx.ErrNoRows
	}
	if err != nil {
		return ItemRow{}, err
	}
	var parentOK bool
	if err := tx.QueryRow(ctx, `
SELECT EXISTS(
	SELECT 1 FROM course.course_structure_items
	WHERE id = $1 AND course_id = $2 AND kind = 'module'
)
`, moduleID, courseID).Scan(&parentOK); err != nil {
		return ItemRow{}, err
	}
	if !parentOK {
		return ItemRow{}, pgx.ErrNoRows
	}

	itemID := uuid.New()
	var r ItemRow
	err = tx.QueryRow(ctx, `
WITH mx AS (
	SELECT COALESCE(MAX(sort_order), -1) AS max_ord
	FROM course.course_structure_items
	WHERE parent_id = $1
)
INSERT INTO course.course_structure_items (
	id, course_id, sort_order, kind, title, parent_id,
	published, visible_from, archived
)
SELECT $2, $3, max_ord + 1, $4, $5, $1,
	true, NULL, false
FROM mx
RETURNING
	id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, blueprint_locked, blueprint_origin_id, created_at, updated_at
`, moduleID, itemID, courseID, kind, title).Scan(
		&r.ID, &r.CourseID, &r.SortOrder, &r.Kind, &r.Title, &r.ParentID, &r.Published, &r.VisibleFrom, &r.Archived, &r.DueAt, &r.AssignmentGroupID, &r.BlueprintLocked, &r.BlueprintOriginID, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return ItemRow{}, err
	}
	if extra != nil {
		if err := extra(tx, r.ID); err != nil {
			return ItemRow{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ItemRow{}, err
	}
	return r, nil
}

// InsertHeadingUnderModule appends a heading row under a module.
func InsertHeadingUnderModule(ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID, title string) (ItemRow, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return ItemRow{}, errors.New("coursestructure: heading title is required")
	}
	return insertModuleChild(ctx, pool, courseID, moduleID, "heading", t, nil)
}

// InsertContentPageUnderModule appends a content page and an empty module_content_pages row.
func InsertContentPageUnderModule(ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID, title string) (ItemRow, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return ItemRow{}, errors.New("coursestructure: content page title is required")
	}
	return insertModuleChild(ctx, pool, courseID, moduleID, "content_page", t, func(tx pgx.Tx, itemID uuid.UUID) error {
		_, err := tx.Exec(ctx, `INSERT INTO course.module_content_pages (structure_item_id, markdown) VALUES ($1, '')`, itemID)
		return err
	})
}

// InsertAssignmentUnderModule appends an assignment and an empty module_assignments row.
func InsertAssignmentUnderModule(ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID, title string) (ItemRow, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return ItemRow{}, errors.New("coursestructure: assignment title is required")
	}
	return insertModuleChild(ctx, pool, courseID, moduleID, "assignment", t, func(tx pgx.Tx, itemID uuid.UUID) error {
		_, err := tx.Exec(ctx, `INSERT INTO course.module_assignments (structure_item_id, markdown) VALUES ($1, '')`, itemID)
		return err
	})
}

// InsertQuizUnderModule appends a quiz and an empty module_quizzes row.
func InsertQuizUnderModule(ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID, title string) (ItemRow, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return ItemRow{}, errors.New("coursestructure: quiz title is required")
	}
	return insertModuleChild(ctx, pool, courseID, moduleID, "quiz", t, func(tx pgx.Tx, itemID uuid.UUID) error {
		_, err := tx.Exec(ctx, `
INSERT INTO course.module_quizzes (structure_item_id, markdown, questions_json)
VALUES ($1, '', '[]'::jsonb)
`, itemID)
		return err
	})
}

// InsertExternalLinkUnderModule appends an external link row and module_external_links.url.
func InsertExternalLinkUnderModule(ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID, title, url string) (ItemRow, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return ItemRow{}, errors.New("coursestructure: external link title is required")
	}
	u := strings.TrimSpace(url)
	return insertModuleChild(ctx, pool, courseID, moduleID, "external_link", t, func(tx pgx.Tx, itemID uuid.UUID) error {
		_, err := tx.Exec(ctx, `INSERT INTO course.module_external_links (structure_item_id, url) VALUES ($1, $2)`, itemID, u)
		return err
	})
}

// InsertLTILinkUnderModule appends an lti_link structure row and course.lti_resource_links.
func InsertLTILinkUnderModule(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID, moduleID, externalToolID uuid.UUID,
	title, resourceLinkID string,
	lineItemURL *string,
) (ItemRow, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return ItemRow{}, errors.New("coursestructure: LTI link title is required")
	}
	rl := strings.TrimSpace(resourceLinkID)
	return insertModuleChild(ctx, pool, courseID, moduleID, "lti_link", t, func(tx pgx.Tx, itemID uuid.UUID) error {
		_, err := tx.Exec(ctx, `
INSERT INTO course.lti_resource_links (course_id, structure_item_id, external_tool_id, resource_link_id, title, line_item_url)
VALUES ($1, $2, $3, $4, $5, $6)
`, courseID, itemID, externalToolID, rl, t, lineItemURL)
		return err
	})
}
