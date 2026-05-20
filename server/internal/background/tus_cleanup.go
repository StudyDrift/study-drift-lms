package background

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SweepStalledTusUploads deletes expired, incomplete tus uploads from the DB and removes
// their temporary chunk files. Returns the number of uploads cleaned up.
func SweepStalledTusUploads(ctx context.Context, pool *pgxpool.Pool, now time.Time) (int, error) {
	rows, queryErr := pool.Query(ctx, `
		SELECT id FROM storage.tus_uploads
		WHERE completed_at IS NULL AND expires_at < $1
		LIMIT 200`, now)
	if queryErr != nil {
		return 0, fmt.Errorf("tus cleanup: query: %w", queryErr)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if scanErr := rows.Scan(&id); scanErr != nil {
			return 0, fmt.Errorf("tus cleanup: scan: %w", scanErr)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("tus cleanup: rows: %w", err)
	}
	if len(ids) == 0 {
		return 0, nil
	}

	for _, id := range ids {
		tmpPath := filepath.Join(os.TempDir(), "tus-"+id+".part")
		_ = os.Remove(tmpPath)
	}

	tag, execErr := pool.Exec(ctx, `
		DELETE FROM storage.tus_uploads
		WHERE completed_at IS NULL AND expires_at < $1`, now)
	if execErr != nil {
		return 0, fmt.Errorf("tus cleanup: delete: %w", execErr)
	}
	return int(tag.RowsAffected()), nil
}
