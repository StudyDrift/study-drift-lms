package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lextures/lextures/server-new/internal/auth"
)

func TestLearningActivity_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/reports/learning-activity", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestLearningActivity_MethodNotAllowed(t *testing.T) {
	s := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: s})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/reports/learning-activity", nil)
	r.Header.Set("Authorization", "Bearer x")
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rr.Code)
	}
}

func TestNewHandler_ReportsRouteRegistered(t *testing.T) {
	s := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: s})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/reports/learning-activity", nil)
	// no bearer — auth runs first, expect 401, not 404
	h.ServeHTTP(rr, r)
	if rr.Code == http.StatusNotFound {
		t.Fatalf("route not registered")
	}
}
