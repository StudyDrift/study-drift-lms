package coursestructure

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateModule inserts a top-level module for a course at the next sort order.
func CreateModule(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, title string) (ItemRow, error) {
	var r ItemRow
	err := pool.QueryRow(ctx, `
WITH next_sort AS (
	SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order
	FROM course.course_structure_items
	WHERE course_id = $1 AND parent_id IS NULL
)
INSERT INTO course.course_structure_items (
	course_id,
	sort_order,
	kind,
	title,
	parent_id,
	published,
	visible_from,
	archived
)
SELECT
	$1,
	next_sort.sort_order,
	'module',
	$2,
	NULL,
	true,
	NULL,
	false
FROM next_sort
RETURNING
	id, course_id, sort_order, kind, title, parent_id, published, visible_from, archived, due_at, assignment_group_id, created_at, updated_at
`, courseID, title).Scan(
		&r.ID, &r.CourseID, &r.SortOrder, &r.Kind, &r.Title, &r.ParentID, &r.Published, &r.VisibleFrom, &r.Archived, &r.DueAt, &r.AssignmentGroupID, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return ItemRow{}, err
	}
	return r, nil
}
