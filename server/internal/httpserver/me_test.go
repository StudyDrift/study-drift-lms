package httpserver

import (
	"testing"
	"net/http"
	"net/http/httptest"
	"context"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/platformstate"
)

func TestHandleMyPermissions_Unauthorized(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{}), Config: config.Config{}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/permissions", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized: got %d", rr.Code)
	}
}

func TestHandleMyOIDCIdentities(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{}), Config: config.Config{}})
	tok, err := signer.Sign(context.Background(), "a0000000-0000-4000-8000-000000000002", "x@y.com", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/oidc-identities", nil)
	r = r.WithContext(context.Background())
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
}

func TestHandleMyOIDCIdentities_MethodNotAllowed(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{}), Config: config.Config{}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/me/oidc-identities", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("method not allowed: %d", rr.Code)
	}
}

func TestHandleDeleteMyOIDCIdentity_MethodNotAllowed(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{}), Config: config.Config{}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/oidc-identities/123", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("method not allowed: %d", rr.Code)
	}
}

func TestHandleDeleteMyOIDCIdentity_Unauthorized(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{}), Config: config.Config{}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodDelete, "/api/v1/me/oidc-identities/123", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized: %d", rr.Code)
	}
}