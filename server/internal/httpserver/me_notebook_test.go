package httpserver

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/platformstate"
)

func TestNotebookQuery_AINotConfigured(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{}), Config: config.Config{}})
	tok, err := signer.Sign(context.Background(), "a0000000-0000-4000-8000-000000000002", "x@y.com", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/me/notebooks/query", strings.NewReader(`{"question":"q","notebooks":[]}`))
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("code: %d body: %s", rr.Code, rr.Body.String())
	}
}

func TestNotebookQuery_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Platform: platformstate.New(config.Config{OpenRouterAPIKey: "k"}), Config: config.Config{OpenRouterAPIKey: "k"}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/me/notebooks/query", strings.NewReader(`{"question":"q","notebooks":[]}`))
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestNotebookQuery_Method(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	tok, _ := signer.Sign(context.Background(), "a0000000-0000-4000-8000-000000000002", "x@y.com", "", "", nil)
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{OpenRouterAPIKey: "k"}), Config: config.Config{OpenRouterAPIKey: "k"}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/notebooks/query", nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestNotebookQuery_PoolNotConfigured(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	tok, _ := signer.Sign(context.Background(), "a0000000-0000-4000-8000-000000000002", "x@y.com", "", "", nil)
	h := NewHandler(Deps{Pool: nil, JWTSigner: signer, Platform: platformstate.New(config.Config{OpenRouterAPIKey: "k"}), Config: config.Config{OpenRouterAPIKey: "k"}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/me/notebooks/query", bytes.NewReader([]byte(`{"question":"q","notebooks":[{"courseCode":"C","markdown":"m"}]}`)))
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestNotebookQuery_InvalidJSON(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	tok, _ := signer.Sign(context.Background(), "a0000000-0000-4000-8000-000000000002", "x@y.com", "", "", nil)
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{OpenRouterAPIKey: "k"}), Config: config.Config{OpenRouterAPIKey: "k"}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/me/notebooks/query", bytes.NewReader([]byte("notjson")))
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("code: %d", rr.Code)
	}
}
