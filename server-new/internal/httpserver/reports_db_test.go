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
	"github.com/lextures/lextures/server-new/internal/models/reports"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
	"github.com/lextures/lextures/server-new/internal/repos/user"
)

func TestLearningActivity_OK_Pg(t *testing.T) {
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
	// Ensure Global Admin can view learning activity reports.
	if _, err := pool.Exec(ctx, `
		INSERT INTO "user".rbac_role_permissions (role_id, permission_id)
		SELECT r.id, p.id
		FROM "user".app_roles r, "user".permissions p
		WHERE r.name = 'Global Admin' AND p.permission_string = 'global:app:reports:view'
		ON CONFLICT (role_id, permission_id) DO NOTHING
	`); err != nil {
		t.Fatalf("grant: %v", err)
	}
	em := "lrpt-" + time.Now().Format("20060102150405") + "@e.com"
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
	orig := timeNowUTC
	timeNowUTC = func() time.Time {
		return time.Date(2026, 4, 20, 12, 0, 0, 0, time.UTC)
	}
	defer func() { timeNowUTC = orig }()

	d := Deps{Pool: pool, JWTSigner: signer}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/reports/learning-activity?from=2026-01-01T00:00:00Z&to=2026-01-20T00:00:00Z",
		nil,
	)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("ok: %d %s", rr.Code, rr.Body.String())
	}
	var out reports.LearningActivityReport
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Summary.TotalEvents < 0 {
		t.Fatalf("summary")
	}
}

func TestLearningActivity_ForbiddenWithoutPerm_Pg(t *testing.T) {
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
	em := "lrp2-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	if err := rbac.AssignUserRoleByName(ctx, pool, mustUUID(row.ID), "Student"); err != nil {
		t.Fatalf("role: %v", err)
	}
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	tok, err := signer.Sign(row.ID, em)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	h := NewHandler(Deps{Pool: pool, JWTSigner: signer})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/reports/learning-activity", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("403: %d", rr.Code)
	}
}

func mustUUID(s string) uuid.UUID {
	u, err := uuid.Parse(s)
	if err != nil {
		panic(err)
	}
	return u
}
