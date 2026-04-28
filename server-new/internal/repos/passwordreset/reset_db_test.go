package passwordreset

import (
	"context"
	"crypto/sha256"
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

func TestTokenLifecycle_Pg(t *testing.T) {
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
	em := "prt-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	raw := "t-" + time.Now().Format("20060102150405.000000000")
	h := sha256.Sum256([]byte(raw))
	exp := time.Now().UTC().Add(time.Hour)
	if err := ReplaceTokenForUser(ctx, pool, uid, h[:], exp); err != nil {
		t.Fatalf("replace: %v", err)
	}
	f, err := FindByTokenHash(ctx, pool, h[:])
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if f == nil {
		t.Fatal("missing row")
	}
	newph, err := auth.HashPassword("otherpassword0")
	if err != nil {
		t.Fatal(err)
	}
	tid, _ := uuid.Parse(f.ID)
	uid2, _ := uuid.Parse(f.UserID)
	ok, err := MarkUsedAndSetPassword(ctx, pool, tid, uid2, newph)
	if err != nil || !ok {
		t.Fatalf("mark: ok=%v err=%v", ok, err)
	}
}
