package coursestructure

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GradedChild summarizes a module child that has at least one recorded grade.
// Used to warn before deletion so the UI can explain why those items get
// archived (preserving grade history) instead of deleted.
type GradedChild struct {
	ID    uuid.UUID
	Title string
	Kind  string
}

// ListModuleChildrenWithGrades returns module children that have any rows in
// course.course_grades, ordered by sort_order. Returns an empty slice when the
// module has no graded children (or does not exist).
func ListModuleChildrenWithGrades(
	ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID,
) ([]GradedChild, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id, c.title, c.kind
		FROM course.course_structure_items c
		WHERE c.course_id = $1
		  AND c.parent_id = $2
		  AND EXISTS (
		      SELECT 1 FROM course.course_grades g
		      WHERE g.module_item_id = c.id
		  )
		ORDER BY c.sort_order
	`, courseID, moduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]GradedChild, 0)
	for rows.Next() {
		var r GradedChild
		if err := rows.Scan(&r.ID, &r.Title, &r.Kind); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// ArchiveCourseModuleAndChildren marks a top-level module and every one of its
// child rows as archived. Used when at least one child has recorded grades, so
// deleting the rows would cascade-delete grade history.
//
// The whole archive runs in a single transaction so we never leave a half-archived
// module on the outline. Returns pgx.ErrNoRows when the module is not found.
func ArchiveCourseModuleAndChildren(
	ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID,
) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE course.course_structure_items
		SET archived = true, updated_at = NOW()
		WHERE id = $1
		  AND course_id = $2
		  AND kind = 'module'
		  AND parent_id IS NULL
	`, moduleID, courseID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}

	if _, err := tx.Exec(ctx, `
		UPDATE course.course_structure_items
		SET archived = true, updated_at = NOW()
		WHERE course_id = $1
		  AND parent_id = $2
	`, courseID, moduleID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// DeleteCourseModule removes a top-level module row. Child rows and any
// dependent data (grades, submissions, etc.) are removed by ON DELETE CASCADE
// foreign keys; callers must verify there are no graded children first via
// ListModuleChildrenWithGrades. Returns pgx.ErrNoRows if the module does not
// exist.
func DeleteCourseModule(
	ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID,
) error {
	tag, err := pool.Exec(ctx, `
		DELETE FROM course.course_structure_items
		WHERE id = $1
		  AND course_id = $2
		  AND kind = 'module'
		  AND parent_id IS NULL
	`, moduleID, courseID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ModuleExists returns true when a top-level module row exists for the given
// course/module id pair. Used to disambiguate "not found" from "no rows
// updated" in handlers.
func ModuleExists(
	ctx context.Context, pool *pgxpool.Pool, courseID, moduleID uuid.UUID,
) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM course.course_structure_items
			WHERE id = $1
			  AND course_id = $2
			  AND kind = 'module'
			  AND parent_id IS NULL
		)
	`, moduleID, courseID).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return exists, nil
}
