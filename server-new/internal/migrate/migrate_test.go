package migrate

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/StudyDrift/lextures/server-new/internal/db"
	"github.com/stretchr/testify/require"
)

func getTestDsn(t *testing.T) string {
	t.Helper()
	d := os.Getenv("TEST_DATABASE_URL")
	if d == "" {
		d = os.Getenv("DATABASE_URL")
	}
	if d == "" {
		t.Skip("set TEST_DATABASE_URL or DATABASE_URL for integration test")
	}
	return d
}

func TestListMigrations(t *testing.T) {
	files, err := listMigrations()
	require.NoError(t, err)
	require.Greater(t, len(files), 10)
	require.Greater(t, files[0].Version, 0)
}

func TestApplyMigrations_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("full migration apply is slow: run without -short in CI")
	}
	dsn := getTestDsn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	t.Cleanup(cancel)
	p, err := db.NewPool(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	// Ensure a clean schema so the full chain runs (databases in CI and local dev are often reused).
	_, err = p.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`)
	require.NoError(t, err)
	require.NoError(t, Apply(ctx, p))
	require.NoError(t, db.Ready(ctx, p))
	require.NoError(t, Apply(ctx, p)) // idempotent
}

// TestMarkVersionsFromSQLxTable ensures versions already recorded in `_sqlx_migrations` (Rust/sqlx)
// are marked in `lextures_go_migrations` without re-executing SQL.
// Every embedded migration number must be listed in `_sqlx_migrations` when simulating a fully
// SQLx-migrated database; otherwise a gap would re-run a migration whose prerequisites were skipped.
func TestMarkVersionsFromSQLxTable(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	dsn := getTestDsn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)
	p, err := db.NewPool(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	_, _ = p.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`)
	_, err = p.Exec(ctx, `CREATE TABLE _sqlx_migrations (version bigint PRIMARY KEY)`)
	require.NoError(t, err)
	files, err := listMigrations()
	require.NoError(t, err)
	for _, f := range files {
		_, err = p.Exec(ctx, `INSERT INTO _sqlx_migrations (version) VALUES ($1)`, f.Version)
		require.NoError(t, err)
	}
	require.NoError(t, Apply(ctx, p))
}
