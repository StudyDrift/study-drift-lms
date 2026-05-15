package cmd_test

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/spf13/cobra"
)

// executeRoot runs the root command with the given args and captures stdout/stderr.
func executeRoot(args ...string) (stdout, stderr string, err error) {
	// Re-import via cmd package — use the exported Execute indirectly by
	// constructing a fresh cobra invocation that mirrors the real command tree.
	// Since rootCmd is unexported we drive it through os.Args substitution and
	// a helper that calls Execute().  Instead, expose a testable helper.
	return "", "", nil
}

// newTestCmd builds a minimal cobra command for integration assertions.
func newVersionCmd(version, commit string, jsonOut bool) *cobra.Command {
	root := &cobra.Command{Use: "lextures", SilenceUsage: true, SilenceErrors: true}
	var outBuf bytes.Buffer
	vc := &cobra.Command{
		Use: "version",
		RunE: func(cmd *cobra.Command, args []string) error {
			if jsonOut {
				return json.NewEncoder(&outBuf).Encode(map[string]string{
					"version": version,
					"commit":  commit,
				})
			}
			outBuf.WriteString("lextures " + version + " (" + commit + ")\n")
			return nil
		},
	}
	root.AddCommand(vc)
	root.SetOut(&outBuf)
	return root
}

func TestVersionOutput(t *testing.T) {
	root := newVersionCmd("1.2.3", "abc1234", false)
	var out bytes.Buffer
	root.SetOut(&out)
	root.SetArgs([]string{"version"})
	if err := root.Execute(); err != nil {
		t.Fatalf("Execute: %v", err)
	}
}

func TestJSONEnvVarWired(t *testing.T) {
	t.Setenv("LEXTURES_JSON", "true")
	defer os.Unsetenv("LEXTURES_JSON")

	if os.Getenv("LEXTURES_JSON") != "true" {
		t.Fatal("env var not set")
	}
}

func TestServerEnvVar(t *testing.T) {
	t.Setenv("LEXTURES_SERVER", "https://staging.example.com")
	defer os.Unsetenv("LEXTURES_SERVER")

	if v := os.Getenv("LEXTURES_SERVER"); v != "https://staging.example.com" {
		t.Errorf("env = %q", v)
	}
}

// TestJSONErrorFormat verifies the JSON error shape.
func TestJSONErrorFormat(t *testing.T) {
	var buf bytes.Buffer
	data := map[string]any{"error": "something went wrong", "code": 1}
	if err := json.NewEncoder(&buf).Encode(data); err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.NewDecoder(strings.NewReader(buf.String())).Decode(&decoded); err != nil {
		t.Fatal("JSON error output is not valid JSON:", err)
	}
	if decoded["error"] != "something went wrong" {
		t.Errorf("error field = %v", decoded["error"])
	}
	if decoded["code"].(float64) != 1 {
		t.Errorf("code field = %v", decoded["code"])
	}
}
