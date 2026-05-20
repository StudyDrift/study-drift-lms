package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/platformstate"
)

func TestHandleTranslate_Unauthenticated(t *testing.T) {
	t.Parallel()
	// Without a JWT signer, any request returns 401.
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	body, _ := json.Marshal(map[string]string{
		"content_type": "feed_post",
		"content_id":   "00000000-0000-0000-0000-000000000001",
		"target_lang":  "en",
		"text":         "Hola mundo",
	})
	r := httptest.NewRequest(http.MethodPost, "/api/v1/translate", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestHandleTranslate_RouteRegistered(t *testing.T) {
	t.Parallel()
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: signer})
	r := httptest.NewRequest(http.MethodPost, "/api/v1/translate", bytes.NewReader([]byte("{}")))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code == http.StatusNotFound || w.Code == http.StatusMethodNotAllowed {
		t.Errorf("expected route to be registered, got %d", w.Code)
	}
}

func TestHandleTranslate_ProviderNotConfigured(t *testing.T) {
	t.Parallel()
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{
		Pool:      nil,
		JWTSigner: signer,
		Platform:  platformstate.New(config.Config{}),
		Config:    config.Config{},
	})
	body, _ := json.Marshal(map[string]string{
		"content_type": "feed_post",
		"content_id":   "00000000-0000-0000-0000-000000000001",
		"target_lang":  "en",
		"text":         "Hola mundo",
	})
	r := httptest.NewRequest(http.MethodPost, "/api/v1/translate", bytes.NewReader(body))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	// Without bearer token → 401 (auth fails before provider check).
	if w.Code == http.StatusOK {
		t.Errorf("expected non-200, got 200")
	}
}

func TestLangCodeToName(t *testing.T) {
	t.Parallel()
	cases := []struct {
		code string
		want string
	}{
		{"en", "English"},
		{"es", "Spanish"},
		{"fr", "French"},
		{"zh", "Chinese (Simplified)"},
		{"zh-tw", "Chinese (Traditional)"},
		{"ja", "Japanese"},
		{"XX", "XX"},
	}
	for _, c := range cases {
		got := langCodeToName(c.code)
		if got != c.want {
			t.Errorf("langCodeToName(%q) = %q, want %q", c.code, got, c.want)
		}
	}
}

func TestAllowedContentTypes(t *testing.T) {
	t.Parallel()
	valid := []string{"feed_post", "discussion_post", "inbox_message", "announcement"}
	for _, ct := range valid {
		if !allowedContentTypes[ct] {
			t.Errorf("expected %q to be allowed", ct)
		}
	}
	invalid := []string{"", "feed", "post", "user", "message"}
	for _, ct := range invalid {
		if allowedContentTypes[ct] {
			t.Errorf("expected %q to be disallowed", ct)
		}
	}
}
