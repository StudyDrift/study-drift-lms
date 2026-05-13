package coursestructure

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PatchCourseModule updates title, published, and visible_from for a top-level module.
// visibleFromSQL is written to visible_from (use nil to clear the column).
func PatchCourseModule(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID, moduleID uuid.UUID,
	title string,
	published bool,
	visibleFromSQL *time.Time,
) (ItemRow, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return ItemRow{}, errors.New("coursestructure: module title is required")
	}
	var r ItemRow
	err := pool.QueryRow(ctx, `
		UPDATE course.course_structure_items
		SET title = $1,
		    published = $2,
		    visible_from = $3,
		    updated_at = NOW()
		WHERE id = $4
		  AND course_id = $5
		  AND kind = 'module'
		  AND parent_id IS NULL
		RETURNING
		    id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, blueprint_locked, blueprint_origin_id, created_at, updated_at
	`, title, published, visibleFromSQL, moduleID, courseID,
	).Scan(
		&r.ID, &r.CourseID, &r.SortOrder, &r.Kind, &r.Title, &r.ParentID, &r.Published, &r.VisibleFrom, &r.Archived, &r.DueAt, &r.AssignmentGroupID, &r.BlueprintLocked, &r.BlueprintOriginID, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return ItemRow{}, err
	}
	return r, nil
}
