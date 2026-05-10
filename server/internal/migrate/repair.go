package migrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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

// demoChecksumRepairMigrations lists versions whose SQL files may legitimately drift
// from what the demo droplet recorded (abbreviated deploys, follow-up PR edits) while
// remaining idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING). When
// MIGRATE_REPAIR_CHECKSUMS is enabled (docker-compose.deploy.yml), stored checksums
// are updated to match the embedded files so migrate can proceed.
var demoChecksumRepairMigrations = []struct {
	version int64
	file    string
}{
	{120, "120_clever_classlink.sql"},
	{135, "135_org_role_grants.sql"},
}

// repairDemoMigrationChecksums updates _sqlx_migrations when a listed version's stored
// checksum does not match the embedded file. Only runs when MIGRATE_REPAIR_CHECKSUMS
// is enabled.
func repairDemoMigrationChecksums(ctx context.Context, c *pgx.Conn, fsys fs.FS, dir string) error {
	if !migrateRepairChecksumsEnabled() {
		return nil
	}
	for _, m := range demoChecksumRepairMigrations {
		if err := repairOneMigrationChecksum(ctx, c, fsys, dir, m.version, m.file); err != nil {
			return err
		}
	}
	return nil
}

func repairOneMigrationChecksum(ctx context.Context, c *pgx.Conn, fsys fs.FS, dir string, version int64, file string) error {
	rel := dir + "/" + file
	body, err := fs.ReadFile(fsys, rel)
	if err != nil {
		return fmt.Errorf("migrate repair v%d: read %q: %w", version, rel, err)
	}
	currentSum := sqlxChecksum(body)

	var rowChecksum []byte
	err = c.QueryRow(ctx,
		`SELECT checksum FROM `+sqlxMigrationsTable+` WHERE version = $1`,
		version,
	).Scan(&rowChecksum)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("migrate repair v%d: %w", version, err)
	}
	if bytes.Equal(rowChecksum, currentSum[:]) {
		return nil
	}
	_, err = c.Exec(ctx,
		`UPDATE `+sqlxMigrationsTable+` SET checksum = $1 WHERE version = $2`,
		currentSum[:], version,
	)
	if err != nil {
		return fmt.Errorf("migrate repair v%d: %w", version, err)
	}
	return nil
}
