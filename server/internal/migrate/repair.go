package migrate

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func migrateRepairChecksumsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("MIGRATE_REPAIR_CHECKSUMS"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// repairMigration120DemoChecksum updates _sqlx_migrations when version 120's stored checksum
// does not match the embedded file (abbreviated deploys, whitespace-only edits, etc.).
// Only runs when MIGRATE_REPAIR_CHECKSUMS is enabled (demo docker-compose.deploy.yml).
func repairMigration120DemoChecksum(ctx context.Context, c *pgx.Conn, fsys fs.FS, dir string) error {
	if !migrateRepairChecksumsEnabled() {
		return nil
	}
	rel := dir + "/120_clever_classlink.sql"
	body, err := fs.ReadFile(fsys, rel)
	if err != nil {
		return err
	}
	currentSum := sqlxChecksum(body)

	var rowChecksum []byte
	err = c.QueryRow(ctx,
		`SELECT checksum FROM `+sqlxMigrationsTable+` WHERE version = $1`,
		int64(120),
	).Scan(&rowChecksum)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	if bytes.Equal(rowChecksum, currentSum[:]) {
		return nil
	}
	_, err = c.Exec(ctx,
		`UPDATE `+sqlxMigrationsTable+` SET checksum = $1 WHERE version = $2`,
		currentSum[:], int64(120),
	)
	return err
}
