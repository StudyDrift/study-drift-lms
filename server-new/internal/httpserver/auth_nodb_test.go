package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lextures/lextures/server-new/internal/auth"
	"github.com/lextures/lextures/server-new/internal/config"
)

func TestOIDCLink_Method(t *testing.T) {
	d := Deps{JWTSigner: auth.NewJWTSigner("01234567890123456789012345678901"), Config: config.Config{}}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/link", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET oidc link: %d", rr.Code)
	}
}

func TestOIDCLink_BadBody(t *testing.T) {
	d := Deps{JWTSigner: auth.NewJWTSigner("01234567890123456789012345678901"), Config: config.Config{OIDCSSOEnabled: true}}
	tok, err := d.JWTSigner.Sign("a0000000-0000-4000-8000-000000000002", "x@y.com")
	if err != nil {
		t.Fatal(err)
	}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/oidc/link", strings.NewReader("notjson"))
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestSAMLStatus_Disabled(t *testing.T) {
	d := Deps{Config: config.Config{}}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/status", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("code: %d", rr.Code)
	}
	var m map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	if m["enabled"] != false {
		t.Fatalf("enabled: %v", m["enabled"])
	}
}

func TestOIDCStatus_DisabledShape(t *testing.T) {
	d := Deps{Config: config.Config{}}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/status", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("code: %d", rr.Code)
	}
	var m map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&m); err != nil {
		t.Fatal(err)
	}
	if m["enabled"] != false {
		t.Fatalf("enabled: %v", m["enabled"])
	}
	prov, _ := m["providers"].([]any)
	if prov == nil || len(prov) != 0 {
		t.Fatalf("providers: %v", m["providers"])
	}
	custom, _ := m["custom"].([]any)
	if custom == nil || len(custom) != 0 {
		t.Fatalf("custom: %v", m["custom"])
	}
}

func TestSAMLStatus_EnabledNoPool(t *testing.T) {
	d := Deps{Config: config.Config{SAMLSSOEnabled: true, SAMLSPX509PEM: "x"}}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/status", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestAuthBody_InvalidJSON(t *testing.T) {
	d := Deps{Pool: nil, JWTSigner: auth.NewJWTSigner("01234567890123456789012345678901"), Config: config.Config{}}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader([]byte("not-json")))
	h.ServeHTTP(rr, r)
	if rr.Code != 400 {
		t.Fatalf("login: %d", rr.Code)
	}
}
