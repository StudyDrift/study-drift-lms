package app

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/lextures/lextures/server"
)

func TestRun_ValidateError(t *testing.T) {
	prev, had := os.LookupEnv("DATABASE_URL")
	t.Cleanup(func() {
		if had {
			_ = os.Setenv("DATABASE_URL", prev)
		} else {
			_ = os.Unsetenv("DATABASE_URL")
		}
	})
	_ = os.Setenv("DATABASE_URL", "http://not-a-postgres-url")
	if err := Run(context.Background(), serverdata.Migrations); err == nil {
		t.Fatalf("expected validate error")
	}
}

// TestRun_ShutdownOnCancel exercises startup and graceful shutdown of the HTTP server and pool.
func TestRun_ShutdownOnCancel(t *testing.T) {
	if testing.Short() {
		t.Skip("needs Postgres and DATABASE_URL")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("set DATABASE_URL for integration test")
	}
	_ = os.Setenv("DATABASE_URL", dsn)
	t.Cleanup(func() { _ = os.Unsetenv("JWT_SECRET") })
	_ = os.Setenv("JWT_SECRET", "01234567890123456789012345678901")
	t.Cleanup(func() { _ = os.Unsetenv("RUN_MIGRATIONS") })
	_ = os.Setenv("RUN_MIGRATIONS", "false")
	t.Cleanup(func() { _ = os.Unsetenv("PORT") })
	_ = os.Setenv("PORT", "0")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := Run(ctx, serverdata.Migrations)
	if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
		t.Fatalf("Run: %v", err)
	}
}
