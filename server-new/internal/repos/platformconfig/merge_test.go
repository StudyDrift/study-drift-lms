package platformconfig

import (
	"testing"

	"github.com/lextures/lextures/server-new/internal/config"
)

func TestMerge_OpenRouterEmptyDBUsesEnv(t *testing.T) {
	env := config.Config{OpenRouterAPIKey: "env-key"}
	db := Row{OpenRouterAPIKey: ptr("")}
	got := Merge(env, &db)
	if got.OpenRouterAPIKey != "env-key" {
		t.Fatalf("OpenRouter: got %q want env", got.OpenRouterAPIKey)
	}
}

func TestMerge_OpenRouterNonEmptyDBOverrides(t *testing.T) {
	env := config.Config{OpenRouterAPIKey: "env-key"}
	db := Row{OpenRouterAPIKey: ptr("db-key")}
	got := Merge(env, &db)
	if got.OpenRouterAPIKey != "db-key" {
		t.Fatalf("OpenRouter: got %q want db", got.OpenRouterAPIKey)
	}
}

func ptr(s string) *string { return &s }
