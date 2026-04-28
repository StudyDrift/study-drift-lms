package user

import (
	"context"
	"os"
	"testing"
	"time"

	serverdata "github.com/lextures/lextures/server-new"
	"github.com/lextures/lextures/server-new/internal/auth"
	"github.com/lextures/lextures/server-new/internal/db"
	"github.com/lextures/lextures/server-new/internal/migrate"
)

func TestFindInsert_Pg(t *testing.T) {
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
	em := "us-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("password1230")
	if err != nil {
		t.Fatal(err)
	}
	u, err := InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	got, err := FindByEmail(ctx, pool, em)
	if err != nil || got == nil || got.ID != u.ID {
		t.Fatalf("find: %v / %+v", err, got)
	}
}
