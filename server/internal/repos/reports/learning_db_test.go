package reports

import (
	"context"
	"os"
	"testing"
	"time"

	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
)

func TestLearningActivityAggregates_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	dsn := os.Getenv("DATABASE_URL")
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2020, 1, 2, 0, 0, 0, 0, time.UTC)
	if _, err := LearningActivitySummary(ctx, pool, from, to); err != nil {
		t.Fatalf("summary: %v", err)
	}
	if _, err := LearningActivityByDay(ctx, pool, from, to); err != nil {
		t.Fatalf("by day: %v", err)
	}
	if _, err := LearningActivityByEventKind(ctx, pool, from, to); err != nil {
		t.Fatalf("by kind: %v", err)
	}
	if _, err := LearningActivityTopCourses(ctx, pool, from, to, 5); err != nil {
		t.Fatalf("top: %v", err)
	}
}
