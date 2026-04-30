package oidc

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestListByUserID_and_Delete_Pg(t *testing.T) {
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
	em := "oidc-" + time.Now().Format("20060102150405") + "@e.com"
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
	var id1, id2 uuid.UUID
	err = pool.QueryRow(ctx, `INSERT INTO settings.user_oidc_identities (user_id, provider, sub, email)
VALUES ($1, 'google', 'g-sub-1', 'a@a.com') RETURNING id`, uid).Scan(&id1)
	if err != nil {
		t.Fatalf("insert oidc1: %v", err)
	}
	err = pool.QueryRow(ctx, `INSERT INTO settings.user_oidc_identities (user_id, provider, sub, email)
VALUES ($1, 'apple', 'ap-sub', NULL) RETURNING id`, uid).Scan(&id2)
	if err != nil {
		t.Fatalf("insert oidc2: %v", err)
	}
	list, err := ListByUserID(ctx, pool, uid)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len: %d", len(list))
	}
	ok, err := DeleteByIDForUser(ctx, pool, uid, id1)
	if err != nil || !ok {
		t.Fatalf("delete: ok=%v err=%v", ok, err)
	}
	list, err = ListByUserID(ctx, pool, uid)
	if err != nil {
		t.Fatalf("list2: %v", err)
	}
	if len(list) != 1 || list[0].ID != id2 {
		t.Fatalf("after delete: %+v", list)
	}
	ok, err = DeleteByIDForUser(ctx, pool, uid, uuid.New())
	if err != nil || ok {
		t.Fatalf("delete missing: ok=%v err=%v", ok, err)
	}
}

func TestInsertLinkIntent_Pg(t *testing.T) {
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
	em := "link-" + time.Now().Format("20060102150405") + "@e.com"
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
	lid, err := InsertLinkIntent(ctx, pool, uid, "google", nil)
	if err != nil {
		t.Fatalf("insert intent: %v", err)
	}
	if lid == uuid.Nil {
		t.Fatal("nil link id")
	}
}
