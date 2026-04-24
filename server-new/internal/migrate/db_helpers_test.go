// Package migrate: integration tests for internal helpers (requires TEST_DATABASE_URL or DATABASE_URL).
package migrate

import (
	"context"
	"testing"
	"time"

	"github.com/StudyDrift/lextures/server-new/internal/db"
	"github.com/stretchr/testify/require"
)

// TestUnexportedMigrationsPath exercises readSQLxVersions, readGoVersions, markApplied, and
// ensureGoTable for coverage without running the full migration change set every time.
func TestUnexportedMigrationsPath_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL")
	}
	dsn := getTestDsn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	p, err := db.NewPool(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)

	_, err = p.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`)
	require.NoError(t, err)

	require.NoError(t, ensureGoTable(ctx, p))
	_, err = p.Exec(ctx, `CREATE TABLE _sqlx_migrations (version bigint PRIMARY KEY)`)
	require.NoError(t, err)
	_, err = p.Exec(ctx, `INSERT INTO _sqlx_migrations (version) VALUES (7)`)
	require.NoError(t, err)
	set, err := readSQLxVersions(ctx, p)
	require.NoError(t, err)
	_, has := set[7]
	require.True(t, has)

	_, err = p.Exec(ctx, `INSERT INTO lextures_go_migrations (version) VALUES (1)`)
	require.NoError(t, err)
	gv, err := readGoVersions(ctx, p)
	require.NoError(t, err)
	require.True(t, gv[1])
	require.NoError(t, markApplied(ctx, p, 99))
	gv2, err := readGoVersions(ctx, p)
	require.NoError(t, err)
	require.True(t, gv2[99])
}

func TestReadGoVersions_MissingTable_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL")
	}
	dsn := getTestDsn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Minute)
	t.Cleanup(cancel)
	p, err := db.NewPool(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	_, err = p.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`)
	require.NoError(t, err)
	// readGoVersions queries lextures_go_migrations; table does not exist yet
	_, err = readGoVersions(ctx, p)
	require.Error(t, err)
}

func TestRunOne_InvalidAndEmpty_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL")
	}
	dsn := getTestDsn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	p, err := db.NewPool(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	_, _ = p.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`)
	require.Error(t, runOne(ctx, p, migrationFile{Version: 900, Name: "empty", SQL: "   "}))
	require.Error(t, runOne(ctx, p, migrationFile{Version: 901, Name: "bad", SQL: "SELEC 1;"}))
}

func TestReadSQLxWhenMissingTable_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL")
	}
	dsn := getTestDsn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Minute)
	t.Cleanup(cancel)
	p, err := db.NewPool(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	_, err = p.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`)
	require.NoError(t, err)
	s, err := readSQLxVersions(ctx, p)
	require.NoError(t, err)
	require.Empty(t, s)
}

// Table exists (Rust/sqlx) but has no rows — distinct path from *missing* table.
func TestReadSQLx_ExistsNoRows_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL")
	}
	dsn := getTestDsn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Minute)
	t.Cleanup(cancel)
	p, err := db.NewPool(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	_, _ = p.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`)
	_, err = p.Exec(ctx, `CREATE TABLE _sqlx_migrations (version bigint PRIMARY KEY)`)
	require.NoError(t, err)
	s, err := readSQLxVersions(ctx, p)
	require.NoError(t, err)
	require.Empty(t, s)
}
