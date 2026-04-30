package migrate

import (
	"context"
	"hash/crc32"

	"github.com/jackc/pgx/v5"
)

// generateLockID is the same formula as launchbadge/sqlx (Postgres migrator) so concurrent
// migration runners (Rust and Go) serialize on the same advisory lock per database.
func generateLockID(databaseName string) int64 {
	const factor int64 = 0x3d32ad9e
	c := crc32.ChecksumIEEE([]byte(databaseName))
	return factor * int64(c)
}

func takeAdvisoryLock(ctx context.Context, c *pgx.Conn) (int64, error) {
	var db string
	if err := c.QueryRow(ctx, "SELECT current_database()").Scan(&db); err != nil {
		return 0, err
	}
	lid := generateLockID(db)
	_, err := c.Exec(ctx, "SELECT pg_advisory_lock($1)", lid)
	return lid, err
}

func releaseAdvisoryLock(ctx context.Context, c *pgx.Conn, lid int64) error {
	_, err := c.Exec(ctx, "SELECT pg_advisory_unlock($1)", lid)
	return err
}
