package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	serverdata "github.com/lextures/lextures/server"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/auth/hibp"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

// HTTP login/signup paths against a real Postgres to cover handler packages.
func TestAuthRoutes_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
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
	cfg := config.Config{PublicWebOrigin: "http://localhost:5173"}
	stub := hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	pass := "J7q#xM2pL9vRkW4$hN8zT1cY5bU6nM0aS"
	d := Deps{Pool: pool, JWTSigner: auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool), Config: cfg, PasswordChecker: stub}
	h := NewHandler(d)
	email := "ht-" + time.Now().Format("20060102150405") + "@e.com"
	body, _ := json.Marshal(map[string]any{
		"email":        email,
		"password":     pass,
		"display_name": "H",
	})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/signup", bytes.NewReader(body))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("signup: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	body2, _ := json.Marshal(map[string]string{"email": email, "password": pass})
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body2))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("login: %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	bad, _ := json.Marshal(authservice.ResetPasswordRequest{Token: "x", Password: pass})
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/reset-password", bytes.NewReader(bad))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 400 {
		t.Fatalf("reset: %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	bf, _ := json.Marshal(map[string]string{"email": email})
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/forgot-password", bytes.NewReader(bf))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("forgot: %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/status", nil)
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("oidc: %d", rr.Code)
	}
	var oidcSt map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&oidcSt); err != nil {
		t.Fatal(err)
	}
	if oidcSt["enabled"] != false {
		t.Fatalf("oidc status enabled: %v", oidcSt["enabled"])
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/status", nil)
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("saml: %d", rr.Code)
	}
	samlBody, err := io.ReadAll(rr.Body)
	if err != nil {
		t.Fatal(err)
	}
	var samlSt map[string]any
	if err := json.Unmarshal(samlBody, &samlSt); err != nil {
		t.Fatal(err)
	}
	if samlSt["enabled"] != false {
		t.Fatalf("saml status: %v", samlSt)
	}
	// sign-in for OIDC link test
	rr = httptest.NewRecorder()
	loginB, _ := json.Marshal(map[string]string{"email": email, "password": pass})
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(loginB))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("login2: %d", rr.Code)
	}
	var loginRes struct {
		Token string `json:"access_token"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&loginRes); err != nil {
		t.Fatal(err)
	}
	oidcOn := cfg
	oidcOn.OIDCSSOEnabled = true
	oidcOn.OIDCPublicBaseURL = "https://oidc.example"
	oidcOn.OIDCGoogleClientID = "g"
	oidcOn.OIDCGoogleClientSecret = "s"
	d2 := Deps{Pool: pool, JWTSigner: auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool), Config: oidcOn, PasswordChecker: stub}
	h2 := NewHandler(d2)
	rr = httptest.NewRecorder()
	bodyLink, _ := json.Marshal(map[string]string{"provider": "google"})
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/oidc/link", bytes.NewReader(bodyLink))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+loginRes.Token)
	h2.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("oidc link: %d %s", rr.Code, rr.Body.String())
	}
	var linkRes struct {
		OK       bool   `json:"ok"`
		LoginURL string `json:"loginUrl"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&linkRes); err != nil {
		t.Fatal(err)
	}
	if !linkRes.OK || !strings.HasPrefix(linkRes.LoginURL, "https://oidc.example/auth/oidc/google/login?linkId=") {
		t.Fatalf("link response: %#v", linkRes)
	}
}

func TestAuthRefreshRotationAndPasswordRevoke_Pg(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
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
	cfg := config.Config{PublicWebOrigin: "http://localhost:5173"}
	stub := hibp.StubChecker{Result: hibp.Result{BreachFound: false, HIBPAvailable: true}}
	pass := "J7q#xM2pL9vRkW4$hN8zT1cY5bU6nM0aS"
	newPass := "K8r#yN3qM0wSlX5%iO9zU2dZ6cV7oN1bT"
	d := Deps{Pool: pool, JWTSigner: auth.NewJWTSignerWithPool("01234567890123456789012345678901", pool), Config: cfg, PasswordChecker: stub}
	h := NewHandler(d)
	email := "rf-" + time.Now().Format("20060102150405") + "@e.com"
	body, _ := json.Marshal(map[string]any{"email": email, "password": pass, "display_name": "R"})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/signup", bytes.NewReader(body))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("signup: %d %s", rr.Code, rr.Body.String())
	}
	var login1 struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&login1); err != nil {
		t.Fatal(err)
	}
	if login1.Refresh == "" || login1.Access == "" {
		t.Fatalf("expected access+refresh from signup: %#v", login1)
	}
	rr = httptest.NewRecorder()
	refBody, _ := json.Marshal(map[string]string{"refresh_token": login1.Refresh})
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", bytes.NewReader(refBody))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("refresh: %d %s", rr.Code, rr.Body.String())
	}
	var refOut struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&refOut); err != nil {
		t.Fatal(err)
	}
	if refOut.Access == "" || refOut.Refresh == "" {
		t.Fatal("expected rotated refresh")
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", bytes.NewReader(refBody))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("replay old refresh: want 401 got %d", rr.Code)
	}
	if _, err := d.JWTSigner.Verify(ctx, login1.Access); err != nil {
		t.Fatalf("pre-password-change access should verify: %v", err)
	}
	rr = httptest.NewRecorder()
	cp, _ := json.Marshal(map[string]string{"current_password": pass, "new_password": newPass})
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/change-password", bytes.NewReader(cp))
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+refOut.Access)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("change password: %d %s", rr.Code, rr.Body.String())
	}
	if _, err := d.JWTSigner.Verify(ctx, login1.Access); err == nil {
		t.Fatal("expected old access JWT rejected after password change (token_invalidated_at)")
	}
	rr = httptest.NewRecorder()
	replayNew, _ := json.Marshal(map[string]string{"refresh_token": refOut.Refresh})
	r = httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", bytes.NewReader(replayNew))
	r = r.WithContext(ctx)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("refresh after password change: want 401 got %d", rr.Code)
	}
}
