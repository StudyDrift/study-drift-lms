package samlidp

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
)

func TestGetDefaultIdP_Empty_Pg(t *testing.T) {
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
	// Use unique entity id to avoid clashing with other tests in same DB.
	sfx := time.Now().Format("150405")
	row, err := UpsertIdP(ctx, pool, nil, &IdPWrite{
		DisplayName: "t",
		EntityID:    "urn:test:entity:" + sfx,
		SSOURL:      "https://idp.example/sso",
		SLOURL:      nil,
		IDPCertPem:  "-----BEGIN CERT-----\nMIIB\n-----END CERT-----\n",
		AttributeMapping: []byte(`{}`),
		ForceSAML:       false,
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if row == nil {
		t.Fatal("expected row")
	}
	g, err := GetDefaultIdP(ctx, pool)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if g == nil || g.ID != row.ID {
		t.Fatalf("default: %+v vs %+v", g, row)
	}
	// update by id
	_, err = UpsertIdP(ctx, pool, &row.ID, &IdPWrite{
		DisplayName: "t2",
		EntityID:    "urn:test:entity2:" + sfx,
		SSOURL:      "https://idp.example/sso2",
		SLOURL:      strPtr("https://idp.example/slo"),
		IDPCertPem:  "-----BEGIN CERT-----\nMIIB\n-----END CERT-----\n",
		AttributeMapping: []byte(`{"email":"mail"}`),
		ForceSAML:       true,
	})
	if err != nil {
		t.Fatalf("upsert2: %v", err)
	}
}

func strPtr(s string) *string { return &s }

func TestUpsertIdP_ByUnknownIDFallsBack_Pg(t *testing.T) {
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
	bad := uuid.New()
	_, err = UpsertIdP(ctx, pool, &bad, &IdPWrite{
		DisplayName: "f",
		EntityID:    "urn:fb:" + uuid.NewString(),
		SSOURL:      "https://e/sso",
		SLOURL:      nil,
		IDPCertPem:  "c",
		AttributeMapping: []byte(`{}`),
		ForceSAML:  false,
	})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
}
