package migrate

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/lextures/lextures/server-new"
	"github.com/lextures/lextures/server-new/internal/db"
)

// TestRun_FullMigrations_Integration runs the 115 SQL files when DATABASE_URL is set (CI, local).
func TestRun_FullMigrations_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("use full go test to exercise migrations with Postgres")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("set DATABASE_URL to run integration test")
	}
	if err := RunWithFS(context.Background(), serverdata.Migrations, dsn); err != nil {
		t.Fatal(err)
	}
	if err := RunWithFS(context.Background(), serverdata.Migrations, dsn); err != nil {
		t.Fatalf("second run: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	p, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer p.Close()
	if err := FromPool(ctx, serverdata.Migrations, p); err != nil {
		t.Fatalf("from pool: %v", err)
	}
}
