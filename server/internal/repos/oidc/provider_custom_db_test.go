package oidc

import (
	"context"
	"os"
	"testing"
	"time"

	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
)

func TestListCustomAndUpsert_Pg(t *testing.T) {
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
	before, err := ListCustomConfigs(ctx, pool)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	newID, err := UpsertCustomConfig(ctx, pool, nil, &CustomConfigWrite{
		DisplayName:  "c-" + time.Now().Format("150405.000000"),
		ClientID:     "c" + time.Now().Format("150405000"),
		ClientSecret: "s",
		DiscoveryURL: "https://disc/.well-known/openid-configuration",
		AttributeMapping: []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("ins: %v", err)
	}
	after, err := ListCustomConfigs(ctx, pool)
	if err != nil {
		t.Fatalf("list2: %v", err)
	}
	if len(after) != len(before)+1 {
		t.Fatalf("len %d -> %d", len(before), len(after))
	}
	_ = after[0].HasClientSecret()
	update, err := UpsertCustomConfig(ctx, pool, &newID, &CustomConfigWrite{
		DisplayName:      "upd",
		ClientID:         "u",
		ClientSecret:     "newsecret",
		DiscoveryURL:     "https://other/.well-known/openid-configuration",
		AttributeMapping: []byte(`{"x":1}`),
	})
	if err != nil {
		t.Fatalf("upd: %v", err)
	}
	if update != newID {
		t.Fatalf("id")
	}
	_ = pool
}

func TestUpsertCustom_NilWrite_Fails(t *testing.T) {
	_, err := UpsertCustomConfig(context.Background(), nil, nil, nil)
	if err == nil {
		t.Fatal("expected err")
	}
}
