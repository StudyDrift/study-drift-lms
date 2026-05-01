package cleverauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	serverdata "github.com/lextures/lextures/server"
	pauth "github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/migrate"
	cleverrepo "github.com/lextures/lextures/server/internal/repos/clever"
)

func TestPkceChallengeS256_RFC7636AppendixB(t *testing.T) {
	v := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	want := "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	if got := pkceChallengeS256(v); got != want {
		t.Fatalf("challenge: got %q want %q", got, want)
	}
}

func TestCompleteLogin_MockCleverAPI(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := migrate.RunWithFS(ctx, serverdata.Migrations, dsn); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	cleverUserID := "cu-" + time.Now().Format("20060102150405")
	meBody := map[string]any{
		"type": "user",
		"data": map[string]any{
			"id":       cleverUserID,
			"district": "dist-1",
			"type":     "user",
		},
	}
	userBody := map[string]any{
		"data": map[string]any{
			"data": map[string]any{
				"email": "student+" + cleverUserID + "@district.edu",
				"name": map[string]any{
					"first": "Pat",
					"last":  "Lee",
				},
				"roles": map[string]any{
					"student": map[string]any{"legacy_id": "x"},
				},
				"is_under_13": true,
			},
		},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/tokens" && r.Method == http.MethodPost:
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "atok"})
		case r.URL.Path == "/v3.0/me":
			_ = json.NewEncoder(w).Encode(meBody)
		case strings.HasPrefix(r.URL.Path, "/v3.0/users/"):
			_ = json.NewEncoder(w).Encode(userBody)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	_ = cleverrepo.DeleteStaleFlowState(ctx, pool)
	if err := cleverrepo.SaveFlowState(ctx, pool, "st1", "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", nil); err != nil {
		t.Fatalf("save flow: %v", err)
	}

	cfg := config.Config{
		PublicWebOrigin:    "http://web",
		OIDCPublicBaseURL:  "http://api",
		CleverSSOEnabled:   true,
		CleverClientID:     "cid",
		CleverClientSecret: "sec",
	}
	s := NewService(cfg)
	s.TokenURL = srv.URL + "/oauth/tokens"
	s.CleverAPIBase = srv.URL + "/v3.0"

	jwt := pauth.NewJWTSigner("01234567890123456789012345678901")
	res, _, err := s.CompleteLogin(ctx, pool, jwt, "authcode", "st1")
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if res.AccessToken == "" {
		t.Fatal("expected app JWT access token")
	}

	var minor bool
	err = pool.QueryRow(ctx, `SELECT is_minor FROM "user".users WHERE clever_id = $1`, cleverUserID).Scan(&minor)
	if err != nil {
		t.Fatalf("lookup user: %v", err)
	}
	if !minor {
		t.Fatalf("expected is_minor from Clever is_under_13")
	}
}
