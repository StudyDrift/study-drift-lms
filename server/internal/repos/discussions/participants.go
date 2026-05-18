package discussions

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListThreadParticipantIDs returns distinct authors in a thread except excludeUserID.
func ListThreadParticipantIDs(ctx context.Context, pool *pgxpool.Pool, threadID, excludeUserID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := pool.Query(ctx, `
SELECT DISTINCT author_id FROM course.discussion_posts
WHERE thread_id = $1 AND author_id <> $2
UNION
SELECT author_id FROM course.discussion_threads WHERE id = $1 AND author_id <> $2
`, threadID, excludeUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
