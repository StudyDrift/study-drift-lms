package config_test

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/lextures/lextures/clients/cli/internal/config"
)

// writeYAML writes content to a temp file and returns its path.
func writeYAML(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "*.yaml")
	if err != nil {
		t.Fatalf("create temp file: %v", err)
	}
	if _, err := fmt.Fprint(f, content); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
	_ = f.Close()
	return f.Name()
}

func TestDefaults(t *testing.T) {
	cfg, err := config.Load(config.LoadOptions{ConfigFile: writeYAML(t, "version: 1\n")})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != config.DefaultServer {
		t.Errorf("Server = %q, want %q", cfg.Server, config.DefaultServer)
	}
	if cfg.JSON {
		t.Error("JSON should default to false")
	}
}

func TestLoadFromFile(t *testing.T) {
	yaml := `
version: 1
server: https://myserver.example.com
api_key: secret123
json: true
`
	cfg, err := config.Load(config.LoadOptions{ConfigFile: writeYAML(t, yaml)})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != "https://myserver.example.com" {
		t.Errorf("Server = %q", cfg.Server)
	}
	if cfg.APIKey != "secret123" {
		t.Errorf("APIKey = %q", cfg.APIKey)
	}
	if !cfg.JSON {
		t.Error("JSON should be true")
	}
}

func TestMissingConfigFile(t *testing.T) {
	// A missing file at the default location should NOT be an error.
	// We simulate this by pointing to a guaranteed-nonexistent path.
	// Load treats ConfigFileNotFoundError (from viper search) as non-fatal,
	// but an explicit file path that doesn't exist IS an error in viper.
	// So we use an empty LoadOptions (no file, custom home).
	// Instead, create a temp home dir with no config file inside.
	home := t.TempDir()
	t.Setenv("HOME", home)

	cfg, err := config.Load(config.LoadOptions{})
	if err != nil {
		t.Fatalf("missing default config should not error: %v", err)
	}
	if cfg.Server != config.DefaultServer {
		t.Errorf("Server = %q, want default", cfg.Server)
	}
}

func TestMalformedYAML(t *testing.T) {
	bad := writeYAML(t, "not: valid: yaml: {\n")
	_, err := config.Load(config.LoadOptions{ConfigFile: bad})
	if err == nil {
		t.Fatal("expected error for malformed YAML")
	}
}

func TestEnvOverridesFile(t *testing.T) {
	yaml := `
version: 1
server: https://file-server.example.com
api_key: file-key
`
	t.Setenv("LEXTURES_SERVER", "https://env-server.example.com")
	t.Setenv("LEXTURES_API_KEY", "env-key")

	cfg, err := config.Load(config.LoadOptions{ConfigFile: writeYAML(t, yaml)})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != "https://env-server.example.com" {
		t.Errorf("Server = %q, want env value", cfg.Server)
	}
	if cfg.APIKey != "env-key" {
		t.Errorf("APIKey = %q, want env value", cfg.APIKey)
	}
}

func TestFlagOverridesEnvAndFile(t *testing.T) {
	yaml := `
version: 1
server: https://file-server.example.com
api_key: file-key
`
	t.Setenv("LEXTURES_SERVER", "https://env-server.example.com")

	cfg, err := config.Load(config.LoadOptions{
		ConfigFile: writeYAML(t, yaml),
		Server:     "https://flag-server.example.com",
		APIKey:     "flag-key",
		JSON:       true,
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != "https://flag-server.example.com" {
		t.Errorf("Server = %q, want flag value", cfg.Server)
	}
	if cfg.APIKey != "flag-key" {
		t.Errorf("APIKey = %q, want flag value", cfg.APIKey)
	}
	if !cfg.JSON {
		t.Error("JSON should be true from flag")
	}
}

func TestPrecedenceAllLayers(t *testing.T) {
	// default < file < env < flag
	fileYAML := "version: 1\nserver: https://file-server.example.com\n"

	t.Setenv("LEXTURES_SERVER", "https://env-server.example.com")

	// Flag wins over env and file.
	cfg, err := config.Load(config.LoadOptions{
		ConfigFile: writeYAML(t, fileYAML),
		Server:     "https://flag-server.example.com",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != "https://flag-server.example.com" {
		t.Errorf("expected flag to win, got %q", cfg.Server)
	}

	// Without flag: env wins over file.
	cfg2, err := config.Load(config.LoadOptions{
		ConfigFile: writeYAML(t, fileYAML),
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg2.Server != "https://env-server.example.com" {
		t.Errorf("expected env to win over file, got %q", cfg2.Server)
	}
}

func TestProfileSelection(t *testing.T) {
	yaml := `
version: 1
server: https://prod.example.com
api_key: prod-key
profiles:
  staging:
    server: https://staging.example.com
    api_key: staging-key
`
	cfg, err := config.Load(config.LoadOptions{
		ConfigFile: writeYAML(t, yaml),
		Profile:    "staging",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != "https://staging.example.com" {
		t.Errorf("Server = %q, want staging server", cfg.Server)
	}
	if cfg.APIKey != "staging-key" {
		t.Errorf("APIKey = %q, want staging key", cfg.APIKey)
	}
}

func TestMissingProfile(t *testing.T) {
	yaml := `version: 1\nserver: https://prod.example.com\n`
	_, err := config.Load(config.LoadOptions{
		ConfigFile: writeYAML(t, yaml),
		Profile:    "nonexistent",
	})
	if err == nil {
		t.Fatal("expected error for nonexistent profile")
	}
}

func TestFlagOverridesProfile(t *testing.T) {
	yaml := `
version: 1
profiles:
  staging:
    server: https://staging.example.com
    api_key: staging-key
`
	cfg, err := config.Load(config.LoadOptions{
		ConfigFile: writeYAML(t, yaml),
		Profile:    "staging",
		Server:     "https://override.example.com",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Server != "https://override.example.com" {
		t.Errorf("Server = %q, flag should override profile", cfg.Server)
	}
}

func TestFilePermissionWarning(t *testing.T) {
	path := writeYAML(t, "version: 1\n")
	if err := os.Chmod(path, 0o644); err != nil {
		t.Skip("cannot chmod:", err)
	}

	// Capture stderr.
	oldStderr := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	_, err := config.Load(config.LoadOptions{ConfigFile: path})

	_ = w.Close()
	os.Stderr = oldStderr

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r); err != nil {
		t.Fatalf("reading pipe: %v", err)
	}

	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !bytes.Contains(buf.Bytes(), []byte("warning")) {
		t.Errorf("expected permission warning on stderr, got: %q", buf.String())
	}
}

func TestNoPermissionWarningFor0600(t *testing.T) {
	path := writeYAML(t, "version: 1\n")
	if err := os.Chmod(path, 0o600); err != nil {
		t.Skip("cannot chmod:", err)
	}

	oldStderr := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	_, err := config.Load(config.LoadOptions{ConfigFile: path})

	_ = w.Close()
	os.Stderr = oldStderr

	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r); err != nil {
		t.Fatalf("reading pipe: %v", err)
	}

	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if bytes.Contains(buf.Bytes(), []byte("warning")) {
		t.Errorf("unexpected permission warning for 0600 file: %q", buf.String())
	}
}

func TestJSONEnvVar(t *testing.T) {
	t.Setenv("LEXTURES_JSON", "true")

	path := filepath.Join(t.TempDir(), "cfg.yaml")
	if err := os.WriteFile(path, []byte("version: 1\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := config.Load(config.LoadOptions{ConfigFile: path})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.JSON {
		t.Error("JSON should be true from env var")
	}
}
