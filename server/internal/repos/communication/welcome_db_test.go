package communication

import (
	"context"
	"os"
	"testing"
	"time"

	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestSendWelcome_Pg(t *testing.T) {
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
	em := "wel-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("password1230")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := user.InsertUser(ctx, pool, em, ph, nil); err != nil {
		t.Fatalf("user: %v", err)
	}
	SendWelcomeMessage(ctx, pool, em)
}
