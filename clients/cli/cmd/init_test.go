package cmd

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// runInitWith drives runInit with simulated stdin lines and captures stdout.
func runInitWith(t *testing.T, cfgPath string, localMode bool, stdinLines ...string) (stdout string, err error) {
	t.Helper()
	input := strings.NewReader(strings.Join(stdinLines, "\n") + "\n")
	var out bytes.Buffer

	// Point the config file to a temp path so we don't touch ~/.lextures.yaml.
	prev := globalFlags.configFile
	globalFlags.configFile = cfgPath
	defer func() { globalFlags.configFile = prev }()

	initCmd := &cobra.Command{}
	initCmd.SetOut(&out)

	err = runInit(initCmd, input, localMode)
	return out.String(), err
}

func TestRunInit_CreatesFileWithDefaults(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")

	// Accept all defaults: blank server (→ default), blank web URL, blank API key.
	stdout, err := runInitWith(t, cfgPath, false, "", "", "")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}

	if !strings.Contains(stdout, "done") {
		t.Errorf("expected 'done' in output, got: %q", stdout)
	}

	data, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("config file not created: %v", err)
	}

	var cfg configFileSchema
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("invalid YAML: %v", err)
	}
	if cfg.Version != 1 {
		t.Errorf("version = %d, want 1", cfg.Version)
	}
	if cfg.Server != "https://app.lextures.com" {
		t.Errorf("server = %q, want default", cfg.Server)
	}
	if cfg.APIKey != "" {
		t.Errorf("api_key = %q, want empty (omitted)", cfg.APIKey)
	}
}

func TestRunInit_CustomServerAndAPIKey(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")

	stdout, err := runInitWith(t, cfgPath, false, "https://staging.lextures.com", "", "sk-test-123")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}
	_ = stdout

	data, _ := os.ReadFile(cfgPath)
	var cfg configFileSchema
	_ = yaml.Unmarshal(data, &cfg)

	if cfg.Server != "https://staging.lextures.com" {
		t.Errorf("server = %q, want staging", cfg.Server)
	}
	if cfg.APIKey != "sk-test-123" {
		t.Errorf("api_key = %q, want sk-test-123", cfg.APIKey)
	}
}

func TestRunInit_FilePermissions(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")

	_, err := runInitWith(t, cfgPath, false, "", "", "")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}

	info, err := os.Stat(cfgPath)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("file permissions = %04o, want 0600", perm)
	}
}

func TestRunInit_ExistingFile_Overwrite(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")

	// Pre-create the file with old content.
	_ = os.WriteFile(cfgPath, []byte("old content"), 0o600)

	// Answer "y" to the overwrite prompt.
	_, err := runInitWith(t, cfgPath, false, "https://new.example.com", "", "", "y")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}

	data, _ := os.ReadFile(cfgPath)
	if strings.Contains(string(data), "old content") {
		t.Error("file still contains old content after overwrite")
	}
}

func TestRunInit_ExistingFile_Abort(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")
	_ = os.WriteFile(cfgPath, []byte("old content"), 0o600)

	stdout, err := runInitWith(t, cfgPath, false, "", "", "", "n")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}

	if !strings.Contains(stdout, "Aborted") {
		t.Errorf("expected 'Aborted' in output, got: %q", stdout)
	}

	// File should be unchanged.
	data, _ := os.ReadFile(cfgPath)
	if string(data) != "old content" {
		t.Error("file was modified after abort")
	}
}

func TestRunInit_NoAPIKey_ShowsLoginHint(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")

	stdout, err := runInitWith(t, cfgPath, false, "", "", "")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}

	if !strings.Contains(stdout, "lextures auth login") {
		t.Errorf("expected login hint, got: %q", stdout)
	}
}

func TestRunInit_WithAPIKey_ShowsAllSet(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")

	stdout, err := runInitWith(t, cfgPath, false, "", "", "my-key")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}

	if !strings.Contains(stdout, "all set") {
		t.Errorf("expected 'all set' in output, got: %q", stdout)
	}
}

func TestRunInit_APIKeyOmittedFromYAMLWhenEmpty(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")
	_, _ = runInitWith(t, cfgPath, false, "", "", "")

	data, _ := os.ReadFile(cfgPath)
	if strings.Contains(string(data), "api_key") {
		t.Errorf("api_key should be omitted when empty, got:\n%s", data)
	}
}

func TestRunInit_ValidYAML(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")
	_, err := runInitWith(t, cfgPath, false, "https://custom.example.com", "", "tok-abc")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}

	data, _ := os.ReadFile(cfgPath)
	var out map[string]any
	if err := yaml.Unmarshal(data, &out); err != nil {
		t.Fatalf("produced invalid YAML: %v\n%s", err, data)
	}
	if fmt.Sprint(out["server"]) != "https://custom.example.com" {
		t.Errorf("server = %v", out["server"])
	}
}

func TestRunInit_LocalMode(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), ".lextures.yaml")

	// Pass localMode=true and accept all defaults.
	_, err := runInitWith(t, cfgPath, true, "", "", "")
	if err != nil {
		t.Fatalf("runInit: %v", err)
	}

	data, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("config file not created: %v", err)
	}

	var cfg configFileSchema
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("invalid YAML: %v", err)
	}
	if cfg.Server != "http://localhost:8080" {
		t.Errorf("server = %q, want http://localhost:8080", cfg.Server)
	}
	if cfg.WebURL != "http://localhost:5173" {
		t.Errorf("web_url = %q, want http://localhost:5173", cfg.WebURL)
	}
}
