package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
)

func TestSettingsAccountGet_RouteRegistered(t *testing.T) {
	d := Deps{JWTSigner: auth.NewJWTSigner("01234567890123456789012345678901"), Config: config.Config{}}
	h := NewHandler(d)
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/settings/account", nil)
	h.ServeHTTP(rr, r)
	if rr.Code == http.StatusNotFound {
		t.Fatalf("expected /api/v1/settings/account to be registered, got 404")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized without bearer token, got %d", rr.Code)
	}
}

func TestNormalizeTheme_RejectsInvalid(t *testing.T) {
	invalid := "solarized"
	if _, err := normalizeTheme(&invalid); err == nil {
		t.Fatalf("expected invalid theme to fail validation")
	}
}

func TestNormalizeTheme_AcceptsKnownValues(t *testing.T) {
	dark := "  DARK "
	got, err := normalizeTheme(&dark)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil || *got != "dark" {
		t.Fatalf("expected normalized dark theme, got %v", got)
	}
}
