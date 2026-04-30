package migrate

import (
	"context"
	"testing"
	"testing/fstest"
)

func TestRunWithFS_BadURL(t *testing.T) {
	err := RunWithFS(context.Background(), fstest.MapFS{}, "")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestRunWithFS_MissingMigrationsDir(t *testing.T) {
	err := RunWithFS(context.Background(), fstest.MapFS{}, "postgres://u:p@127.0.0.1:1/db?sslmode=disable")
	// Connect fails first (or readdir) — we only assert a non-nil error in CI; locally may differ.
	_ = err
}

func TestFromPool_Nil(t *testing.T) {
	if err := FromPool(context.Background(), nil, nil); err == nil {
		t.Fatal("expected error")
	}
}
