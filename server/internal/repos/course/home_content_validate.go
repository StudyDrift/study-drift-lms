package course

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ValidHomeContentPage reports whether itemID is a content_page row in the given course.
func ValidHomeContentPage(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.course_structure_items i
	WHERE i.id = $1 AND i.course_id = $2 AND i.kind = 'content_page'
)
`, itemID, courseID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}
