package rbac

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server-new"
	"github.com/lextures/lextures/server-new/internal/auth"
	"github.com/lextures/lextures/server-new/internal/db"
	"github.com/lextures/lextures/server-new/internal/migrate"
	"github.com/lextures/lextures/server-new/internal/repos/user"
)

func TestUserHasPermission_GlobalRbac_Pg(t *testing.T) {
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
	em := "uhpm-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	uid, err := uuid.Parse(row.ID)
	if err != nil {
		t.Fatal(err)
	}
	const p = "global:app:rbac:manage"
	ok, err := UserHasPermission(ctx, pool, uid, p)
	if err != nil {
		t.Fatalf("user has: %v", err)
	}
	if ok {
		t.Fatal("expected no global rbac without role")
	}
	if err := AssignUserRoleByName(ctx, pool, uid, "Global Admin"); err != nil {
		t.Fatalf("assign ga: %v", err)
	}
	ok, err = UserHasPermission(ctx, pool, uid, p)
	if err != nil {
		t.Fatalf("user has2: %v", err)
	}
	if !ok {
		t.Fatal("expected global rbac for Global Admin")
	}
}
