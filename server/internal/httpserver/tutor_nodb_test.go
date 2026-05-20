package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/platformstate"
)

func TestTutor_Unauthenticated(t *testing.T) {
	// GET and DELETE endpoints require auth before any other check.
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/courses/C-TEST/tutor/conversation"},
		{http.MethodDelete, "/api/v1/courses/C-TEST/tutor/conversation"},
		{http.MethodGet, "/api/v1/me/token-budget"},
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(c.method, c.path, nil)
		h.ServeHTTP(rr, r)
		if rr.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: want 401, got %d", c.method, c.path, rr.Code)
		}
	}

	// POST message checks AI config first (same pattern as notebook query).
	// Without AI configured it returns 503 even for unauthenticated users.
	hAI := NewHandler(Deps{
		Pool:      nil,
		JWTSigner: nil,
		Platform:  platformstate.New(config.Config{OpenRouterAPIKey: "k"}),
		Config:    config.Config{OpenRouterAPIKey: "k"},
	})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/courses/C-TEST/tutor/message",
		strings.NewReader(`{"message":"hi"}`))
	hAI.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("POST tutor/message without auth: want 401, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestTutor_RoutesRegistered(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: signer})
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/courses/C-TEST/tutor/conversation"},
		{http.MethodPost, "/api/v1/courses/C-TEST/tutor/message"},
		{http.MethodDelete, "/api/v1/courses/C-TEST/tutor/conversation"},
		{http.MethodGet, "/api/v1/me/token-budget"},
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(c.method, c.path, nil)
		h.ServeHTTP(rr, r)
		if rr.Code == http.StatusMethodNotAllowed {
			t.Errorf("%s %s: route not registered (got 405)", c.method, c.path)
		}
	}
}

func TestTutor_PostMessage_AINotConfigured(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	tok, _ := signer.Sign(context.Background(), "a0000000-0000-4000-8000-000000000002", "x@y.com", "", "", nil)
	h := NewHandler(Deps{JWTSigner: signer, Platform: platformstate.New(config.Config{}), Config: config.Config{}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/courses/C-TEST/tutor/message",
		strings.NewReader(`{"message":"hello"}`))
	r.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503, got %d body=%s", rr.Code, rr.Body.String())
	}
}

func TestTutor_PostMessage_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Platform: platformstate.New(config.Config{OpenRouterAPIKey: "k"}), Config: config.Config{OpenRouterAPIKey: "k"}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/courses/C-TEST/tutor/message",
		strings.NewReader(`{"message":"hello"}`))
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}
