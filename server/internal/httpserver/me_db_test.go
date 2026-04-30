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
	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/repos/user"
)

func TestMeOIDCIdentities_Pg(t *testing.T) {
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
	em := "meoidc-" + time.Now().Format("20060102150405") + "@e.com"
	ph, err := auth.HashPassword("longpassword0")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	row, err := user.InsertUser(ctx, pool, em, ph, nil)
	if err != nil {
		t.Fatalf("user: %v", err)
	}
	uid, _ := uuid.Parse(row.ID)
	var oidcID uuid.UUID
	err = pool.QueryRow(ctx, `INSERT INTO settings.user_oidc_identities (user_id, provider, sub, email)
VALUES ($1, 'google', 'sub-me', 'x@y.com') RETURNING id`, uid).Scan(&oidcID)
	if err != nil {
		t.Fatalf("oidc: %v", err)
	}
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	tok, err := signer.Sign(row.ID, em)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	d := Deps{Pool: pool, JWTSigner: signer}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/oidc-identities", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rr.Code, rr.Body.String())
	}
	var out oidcIdentitiesResponse
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if len(out.Identities) != 1 || out.Identities[0].ID != oidcID.String() {
		t.Fatalf("identities: %+v", out)
	}
	rr = httptest.NewRecorder()
	badID := uuid.New()
	r = httptest.NewRequest(http.MethodDelete, "/api/v1/me/oidc-identities/"+badID.String(), nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("delete other: %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodDelete, "/api/v1/me/oidc-identities/"+oidcID.String(), nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/v1/me/oidc-identities", nil)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("list2: %d", rr.Code)
	}
	if err := json.NewDecoder(rr.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if len(out.Identities) != 0 {
		t.Fatalf("empty: %+v", out)
	}
}
