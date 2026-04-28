package coursestructure

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// patchableChildKinds matches Rust `patch_child_structure_item` (child rows only, not top-level modules).
const patchableChildKindsSQL = `IN ('heading', 'content_page', 'assignment', 'quiz', 'external_link', 'survey', 'lti_link')`

// PatchChildStructureItem updates title, published, and/or archived for a module child item.
func PatchChildStructureItem(
	ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, title *string, published, archived *bool,
) (ItemRow, error) {
	var r ItemRow
	err := pool.QueryRow(ctx, `
		UPDATE course.course_structure_items
		SET title = COALESCE($1, title),
		    published = COALESCE($2, published),
		    archived = COALESCE($3, archived),
		    updated_at = NOW()
		WHERE id = $4
		  AND course_id = $5
		  AND parent_id IS NOT NULL
		  AND kind `+patchableChildKindsSQL+`
		RETURNING
		    id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
	`, title, published, archived, itemID, courseID,
	).Scan(
		&r.ID, &r.CourseID, &r.SortOrder, &r.Kind, &r.Title, &r.ParentID, &r.Published, &r.VisibleFrom, &r.Archived, &r.DueAt, &r.AssignmentGroupID, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return ItemRow{}, err
	}
	return r, nil
}

// ItemResponseForRow enriches a single item for JSON responses.
func ItemResponseForRow(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, row ItemRow) (ItemResponse, error) {
	resp, err := RowsToResponsesWithQuizAdaptive(ctx, pool, courseID, []ItemRow{row})
	if err != nil {
		return ItemResponse{}, err
	}
	if len(resp) != 1 {
		return ItemResponse{}, errors.New("coursestructure: expected one enriched item")
	}
	return resp[0], nil
}

// ArchiveChildStructureItem sets archived = true for a child row.
func ArchiveChildStructureItem(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) error {
	tag, err := pool.Exec(ctx, `
		UPDATE course.course_structure_items
		SET archived = true, updated_at = NOW()
		WHERE id = $1
		  AND course_id = $2
		  AND parent_id IS NOT NULL
		  AND kind `+patchableChildKindsSQL,
		itemID, courseID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
