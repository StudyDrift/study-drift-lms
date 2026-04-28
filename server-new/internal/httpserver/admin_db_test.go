package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	serverdata "github.com/lextures/lextures/server-new"
	"github.com/lextures/lextures/server-new/internal/auth"
	"github.com/lextures/lextures/server-new/internal/db"
	"github.com/lextures/lextures/server-new/internal/migrate"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
	"github.com/lextures/lextures/server-new/internal/repos/user"
)

func TestAdmin_OIDCList_OK_Pg(t *testing.T) {
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
	em := "admn-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	if err := rbac.AssignUserRoleByName(ctx, pool, uid, "Global Admin"); err != nil {
		t.Fatalf("ga: %v", err)
	}
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	tok, err := signer.Sign(row.ID, em)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/oidc/providers", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("ok: %d %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Providers []any `json:"providers"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Providers == nil {
		t.Fatal("expected providers array")
	}
}

func TestAdmin_Forbidden_WithoutGA_Pg(t *testing.T) {
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
	em := "noga-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, uuid.MustParse(row.ID), "Student"); err != nil {
		t.Fatalf("st: %v", err)
	}
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	tok, err := signer.Sign(row.ID, em)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/oidc/providers", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("forbidden: %d", rr.Code)
	}
}
