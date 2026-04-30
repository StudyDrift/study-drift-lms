package coursemoduleassignments

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DueReleaseRow is a course + structure item id pair for a past-due scheduled grade release.
type DueReleaseRow struct {
	CourseID          uuid.UUID
	StructureItemID   uuid.UUID
}

// ListStructuresWithPastDueRelease returns assignments whose manual release time has passed.
func ListStructuresWithPastDueRelease(ctx context.Context, pool *pgxpool.Pool, asOf time.Time) ([]DueReleaseRow, error) {
	rows, err := pool.Query(ctx, `
SELECT c.course_id, c.id
FROM course.module_assignments m
INNER JOIN course.course_structure_items c ON c.id = m.structure_item_id
WHERE m.posting_policy = 'manual'
  AND m.release_at IS NOT NULL
  AND m.release_at <= $1
`, asOf)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DueReleaseRow
	for rows.Next() {
		var r DueReleaseRow
		if err := rows.Scan(&r.CourseID, &r.StructureItemID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ClearReleaseAt clears release_at after a scheduled post (Rust `course_module_assignments::clear_release_at`).
func ClearReleaseAt(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
UPDATE course.module_assignments m
SET release_at = NULL, settings_version = m.settings_version + 1, updated_at = NOW()
FROM course.course_structure_items c
WHERE m.structure_item_id = c.id
  AND c.id = $1
  AND c.course_id = $2
  AND c.kind = 'assignment'
`, itemID, courseID)
	return err
}
