// Package migrate applies the same versioned SQL files the Rust service uses, using the
// _sqlx_migrations table and SHA-384 checksums for compatibility.
package migrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const sqlxMigrationsTable = "_sqlx_migrations"

// RunWithFS applies SQL migrations from fsys (directory root, e.g. "migrations").
func RunWithFS(ctx context.Context, fsys fs.FS, dsn string) error {
	if dsn == "" {
		return fmt.Errorf("migrate: empty database URL")
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return fmt.Errorf("migrate: parse config: %w", err)
	}
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("migrate: connect: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()
	return runLocked(ctx, conn, fsys, "migrations")
}

// FromPool runs migrations from fsys using the DSN in an existing pool.
func FromPool(ctx context.Context, fsys fs.FS, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("migrate: nil pool")
	}
	return RunWithFS(ctx, fsys, pool.Config().ConnString())
}

func runLocked(ctx context.Context, conn *pgx.Conn, fsys fs.FS, dir string) error {
	lid, err := takeAdvisoryLock(ctx, conn)
	if err != nil {
		return fmt.Errorf("migrate: lock: %w", err)
	}
	defer func() { _ = releaseAdvisoryLock(context.Background(), conn, lid) }()
	if err := ensureMigrationsTable(ctx, conn); err != nil {
		return err
	}
	if err := checkNotDirty(ctx, conn); err != nil {
		return err
	}
	if err := repairMigration120DemoChecksum(ctx, conn, fsys, dir); err != nil {
		return err
	}
	entries, err := fs.ReadDir(fsys, dir)
	if err != nil {
		return fmt.Errorf("migrate: readdir: %w", err)
	}
	var list []migrationFile
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		p := dir + "/" + e.Name()
		mf, perr := parseMigrationName(p)
		if perr != nil {
			return perr
		}
		list = append(list, mf)
	}
	sortMigrations(list)
	for _, mf := range list {
		p := dir + "/" + mf.Name
		if err := applyIfNeeded(ctx, conn, fsys, p, mf); err != nil {
			return err
		}
	}
	return nil
}

func ensureMigrationsTable(ctx context.Context, c *pgx.Conn) error {
	q := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s (
  version BIGINT PRIMARY KEY,
  description TEXT NOT NULL,
  installed_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL,
  checksum BYTEA NOT NULL,
  execution_time BIGINT NOT NULL
);`, sqlxMigrationsTable)
	_, err := c.Exec(ctx, q)
	if err != nil {
		return fmt.Errorf("migrate: create table: %w", err)
	}
	return nil
}

func checkNotDirty(ctx context.Context, c *pgx.Conn) error {
	var ver int64
	err := c.QueryRow(ctx, fmt.Sprintf(
		"SELECT version FROM %s WHERE success = false ORDER BY version LIMIT 1", sqlxMigrationsTable,
	)).Scan(&ver)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("migrate: dirty: %w", err)
	}
	return fmt.Errorf("migrate: previous migration (version %d) did not complete successfully; fix _sqlx_migrations before continuing", ver)
}

func applyIfNeeded(ctx context.Context, c *pgx.Conn, fsys fs.FS, rel string, mf migrationFile) error {
	body, err := fs.ReadFile(fsys, rel)
	if err != nil {
		return fmt.Errorf("migrate: read %q: %w", rel, err)
	}
	sum := sqlxChecksum(body)

	var rowChecksum []byte
	sel := fmt.Sprintf("SELECT checksum FROM %s WHERE version = $1", sqlxMigrationsTable)
	scanErr := c.QueryRow(ctx, sel, mf.Version).Scan(&rowChecksum)
	if scanErr == nil {
		if !bytes.Equal(rowChecksum, sum[:]) {
			return fmt.Errorf("migrate: %s was modified after apply (version %d checksum mismatch)", rel, mf.Version)
		}
		return nil
	}
	if !errors.Is(scanErr, pgx.ErrNoRows) {
		return fmt.Errorf("migrate: lookup version %d: %w", mf.Version, scanErr)
	}

	// New migration: one transaction (sql + row insert), then post-commit execution_time update
	// like sqlx (separate update on a clean connection; we keep a single follow-up update).
	t0 := time.Now()
	tx, err := c.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, string(body)); err != nil {
		return fmt.Errorf("migrate: exec v%d: %w", mf.Version, err)
	}
	ins := fmt.Sprintf("INSERT INTO %s (version, description, success, checksum, execution_time) VALUES ($1, $2, true, $3, -1)", sqlxMigrationsTable)
	if _, err := tx.Exec(ctx, ins, int64(mf.Version), mf.Description, sum[:]); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	elapsed := time.Since(t0).Nanoseconds()
	u := fmt.Sprintf("UPDATE %s SET execution_time = $1 WHERE version = $2", sqlxMigrationsTable)
	if _, err := c.Exec(ctx, u, elapsed, int64(mf.Version)); err != nil {
		return fmt.Errorf("migrate: set execution time v%d: %w", mf.Version, err)
	}
	return nil
}
