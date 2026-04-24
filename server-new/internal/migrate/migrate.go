// Package migrate applies `migrations/*.sql` in version order, compatible with databases
// that were previously migrated by the Rust server using SQLx.
package migrate

import (
	"context"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"strings"

	sqlfiles "github.com/StudyDrift/lextures/server-new/migrations"
	"github.com/jackc/pgx/v5/pgxpool"
)

const migrationTable = "lextures_go_migrations"

var nameRe = regexp.MustCompile(`^(\d+)_(.+)\.sql$`)

// migrationFile is one embedded SQL file.
type migrationFile struct {
	Version     int
	Name        string
	SQL         string
	relPath     string
}

// Apply runs all pending migrations. If `public._sqlx_migrations` exists (from the legacy Rust
// server), versions that are already recorded there are marked as applied without re-running SQL,
// so a cutover to this binary does not repeat DDL.
func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	files, err := listMigrations()
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return fmt.Errorf("no migration files found in embed")
	}

	if err := ensureGoTable(ctx, pool); err != nil {
		return err
	}

	sqlxDone, err := readSQLxVersions(ctx, pool)
	if err != nil {
		return err
	}
	goDone, err := readGoVersions(ctx, pool)
	if err != nil {
		return err
	}

	for _, f := range files {
		if goDone[f.Version] {
			continue
		}
		if _, inSQLx := sqlxDone[f.Version]; inSQLx {
			if err := markApplied(ctx, pool, f.Version); err != nil {
				return err
			}
			continue
		}
		if err := runOne(ctx, pool, f); err != nil {
			return fmt.Errorf("migration %d (%s): %w", f.Version, f.Name, err)
		}
	}
	return nil
}

func listMigrations() ([]migrationFile, error) {
	ents, err := sqlfiles.Files.ReadDir(".")
	if err != nil {
		return nil, err
	}
	var out []migrationFile
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		// skip non-sql (e.g. embed.go is not in embed)
		if !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		m := nameRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		ver, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		rel := e.Name()
		b, err := fs.ReadFile(sqlfiles.Files, rel)
		if err != nil {
			return nil, err
		}
		out = append(out, migrationFile{
			Version: ver,
			Name:    m[2],
			SQL:     string(b),
			relPath: rel,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

func ensureGoTable(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, fmt.Sprintf(`
CREATE TABLE IF NOT EXISTS %s (
  version bigint PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`, migrationTable))
	return err
}

func readSQLxVersions(ctx context.Context, pool *pgxpool.Pool) (map[int]struct{}, error) {
	var exists bool
	if err := pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = '_sqlx_migrations'
)`).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return map[int]struct{}{}, nil
	}
	rows, err := pool.Query(ctx, `SELECT version FROM _sqlx_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	set := make(map[int]struct{})
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		set[int(v)] = struct{}{}
	}
	return set, rows.Err()
}

func readGoVersions(ctx context.Context, pool *pgxpool.Pool) (map[int]bool, error) {
	rows, err := pool.Query(ctx, fmt.Sprintf(`SELECT version FROM %s`, migrationTable))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	set := make(map[int]bool)
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		set[int(v)] = true
	}
	return set, rows.Err()
}

func markApplied(ctx context.Context, pool *pgxpool.Pool, version int) error {
	_, err := pool.Exec(ctx, fmt.Sprintf(
		`INSERT INTO %s (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`, migrationTable), version)
	return err
}

func runOne(ctx context.Context, pool *pgxpool.Pool, f migrationFile) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	sqlText := strings.TrimSpace(f.SQL)
	if sqlText == "" {
		return fmt.Errorf("empty migration file")
	}
	if _, err := tx.Exec(ctx, sqlText); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf(
		`INSERT INTO %s (version) VALUES ($1)`, migrationTable), f.Version); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
