package platformconfig

import (
	"bytes"
	"testing"

	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/crypto/appsecrets"
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

func TestMerge_SMTPPasswordDecryptsFromDB(t *testing.T) {
	key := bytes.Repeat([]byte{11}, 32)
	blob, err := appsecrets.Encrypt([]byte("db-secret"), key)
	if err != nil {
		t.Fatal(err)
	}
	env := config.Config{SMTPHost: "h1", SMTPPassword: "envpw", PlatformSecretsKey: key}
	db := Row{SMTPPasswordCiphertext: blob}
	got := Merge(env, &db)
	if got.SMTPPassword != "db-secret" {
		t.Fatalf("SMTPPassword: got %q", got.SMTPPassword)
	}
	if got.SMTPHost != "h1" {
		t.Fatalf("SMTPHost: got %q", got.SMTPHost)
	}
}

func TestMerge_SMTPHostFromDB(t *testing.T) {
	env := config.Config{SMTPHost: "env-host", SMTPPort: 25}
	db := Row{SMTPHost: ptr("db-host")}
	got := Merge(env, &db)
	if got.SMTPHost != "db-host" || got.SMTPPort != 25 {
		t.Fatalf("got host=%q port=%d", got.SMTPHost, got.SMTPPort)
	}
}

func ptr(s string) *string { return &s }
