package coursestructure

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ItemBlueprintLockState returns whether a structure item is blueprint-locked in a course.
func ItemBlueprintLockState(
	ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID,
) (locked bool, found bool, err error) {
	var b bool
	e := pool.QueryRow(ctx, `
		SELECT blueprint_locked
		FROM course.course_structure_items
		WHERE id = $1 AND course_id = $2
	`, itemID, courseID).Scan(&b)
	if e == nil {
		return b, true, nil
	}
	if e == pgx.ErrNoRows {
		return false, false, nil
	}
	return false, false, e
}
