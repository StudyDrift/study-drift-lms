package migrate

import (
	"context"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

// checksumMigration120ShortB3302c2 is the SHA-384 of migration 120 after commit b3302c2
// (abbreviated Clever/ClassLink migration without connected_via in the same file).
// Demo databases that ran that image store this checksum; current repo embeds the full 120 again.
const checksumMigration120ShortB3302c2Hex = "fa3ba70e2438dbc527c48041913cff56a142f6dc7acf3c6f33fd39830ee7c17edb4efcc1c807a57791c0a2ae0ce32c3a"

func migrateRepairChecksumsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("MIGRATE_REPAIR_CHECKSUMS"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// repairMigration120DemoChecksum updates _sqlx_migrations when version 120 still holds the
// checksum for the shortened migration file (deploy rollback confusion). Safe no-op otherwise.
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

	oldBytes, err := hex.DecodeString(checksumMigration120ShortB3302c2Hex)
	if err != nil || len(oldBytes) != len(currentSum) {
		return errors.New("migrate: internal checksum constant length")
	}

	var rowChecksum []byte
	err = c.QueryRow(ctx,
		`SELECT checksum FROM `+sqlxMigrationsTable+` WHERE version = $1`,
		int64(120),
	).Scan(&rowChecksum)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if string(rowChecksum) == string(currentSum[:]) {
		return nil
	}
	if string(rowChecksum) != string(oldBytes) {
		return nil
	}
	_, err = c.Exec(ctx,
		`UPDATE `+sqlxMigrationsTable+` SET checksum = $1 WHERE version = $2`,
		currentSum[:], int64(120),
	)
	return err
}
