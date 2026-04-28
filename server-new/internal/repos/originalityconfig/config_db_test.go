package originalityconfig

import (
	"context"
	"os"
	"testing"
	"time"

	serverdata "github.com/lextures/lextures/server-new"
	"github.com/lextures/lextures/server-new/internal/db"
	"github.com/lextures/lextures/server-new/internal/migrate"
)

func TestUpsertSingleton_Pg(t *testing.T) {
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
	now := time.Now().UTC()
	if err := UpsertSingleton(ctx, pool, &Write{
		DpaAcceptedAt:          &now,
		ActiveExternalProvider: "none",
		SimilarityAmberMinPct:  25,
		SimilarityRedMinPct:    50,
		AIAmberMinPct:         25,
		AIRedMinPct:            50,
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
}
