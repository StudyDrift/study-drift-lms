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
	"github.com/google/uuid"
)

// TestSendAndListInbox is a high-level parity check for mailbox rows (DATABASE_URL in CI).
func TestSendAndListInbox_Pg(t *testing.T) {
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

	prefix := "mb-" + time.Now().Format("20060102150405")
	a := prefix + "-a@e.com"
	b := prefix + "-b@e.com"
	ph, err := auth.HashPassword("p")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := user.InsertUser(ctx, pool, a, ph, nil); err != nil {
		t.Fatalf("user a: %v", err)
	}
	if _, err := user.InsertUser(ctx, pool, b, ph, nil); err != nil {
		t.Fatalf("user b: %v", err)
	}
	ua, _ := user.FindByEmail(ctx, pool, user.NormalizeEmail(a))
	ub, _ := user.FindByEmail(ctx, pool, user.NormalizeEmail(b))
	if ua == nil || ub == nil {
		t.Fatal("expected users")
	}
	senderID, err := uuid.Parse(ua.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = SendMessage(ctx, pool, senderID, b, "subj", "hello there body")
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	recvID, err := uuid.Parse(ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	ms, err := ListForUser(ctx, pool, recvID, "inbox", "")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(ms) != 1 {
		t.Fatalf("inbox: %d", len(ms))
	}
	if n, err := CountUnreadInbox(ctx, pool, recvID); err != nil || n != 1 {
		t.Fatalf("unread: %d %v", n, err)
	}
}
