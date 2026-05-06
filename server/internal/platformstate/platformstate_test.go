package platformstate

import (
	"testing"

	"github.com/lextures/lextures/server/internal/config"
)

func TestNew_NoOpenRouter(t *testing.T) {
	p := New(config.Config{})
	if p.OpenRouter() != nil {
		t.Fatal("expected nil OpenRouter when key is empty")
	}
	if p.Config().OpenRouterAPIKey != "" {
		t.Fatal("expected empty key")
	}
}

func TestNew_WithOpenRouter(t *testing.T) {
	p := New(config.Config{OpenRouterAPIKey: "sk-test"})
	if p.OpenRouter() == nil {
		t.Fatal("expected non-nil OpenRouter")
	}
}

func TestNew_WhitespaceKey(t *testing.T) {
	p := New(config.Config{OpenRouterAPIKey: "   "})
	if p.OpenRouter() != nil {
		t.Fatal("expected nil OpenRouter for whitespace-only key")
	}
}

func TestReload(t *testing.T) {
	p := New(config.Config{})
	if p.OpenRouter() != nil {
		t.Fatal("precondition")
	}
	p.Reload(config.Config{OpenRouterAPIKey: "sk-x"})
	if p.OpenRouter() == nil {
		t.Fatal("expected client after reload with key")
	}
	p.Reload(config.Config{})
	if p.OpenRouter() != nil {
		t.Fatal("expected nil after reload with empty key")
	}
}

func TestConfig_RoundTrip(t *testing.T) {
	cfg := config.Config{OpenRouterAPIKey: "k", JWTSecret: "secret"}
	p := New(cfg)
	got := p.Config()
	if got.JWTSecret != "secret" {
		t.Fatalf("got %q", got.JWTSecret)
	}
}
