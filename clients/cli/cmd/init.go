package cmd

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/lextures/lextures/clients/cli/internal/config"
	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// configFileSchema is the minimal struct written to ~/.lextures.yaml by --init.
type configFileSchema struct {
	Version int    `yaml:"version"`
	Server  string `yaml:"server"`
	WebURL  string `yaml:"web_url,omitempty"`
	APIKey  string `yaml:"api_key,omitempty"`
}

// runInit drives the interactive setup wizard and writes ~/.lextures.yaml.
// in is typically os.Stdin; pass a *strings.Reader in tests.
func runInit(cmd *cobra.Command, in io.Reader, localMode bool) error {
	out := cmd.OutOrStdout()
	r := bufio.NewReader(in)

	_, _ = fmt.Fprintln(out, "Lextures CLI setup")
	_, _ = fmt.Fprintln(out, "==================")
	_, _ = fmt.Fprintln(out)

	defaultServer := config.DefaultServer
	defaultWebURL := ""
	if localMode {
		defaultServer = "http://localhost:8080"
		defaultWebURL = "http://localhost:5173"
	}

	server := promptLine(r, out, "Server URL", defaultServer)
	if defaultWebURL == "" {
		defaultWebURL = server
	}
	webURL := promptLine(r, out, "Web app URL", defaultWebURL)
	apiKey := promptLine(r, out, "API key (leave blank to log in via browser)", "")

	// Determine config path: honour --config flag if set, else ~/.lextures.yaml.
	cfgPath := globalFlags.configFile
	if cfgPath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("cannot determine home directory: %w", err)
		}
		cfgPath = filepath.Join(home, ".lextures.yaml")
	}

	// Warn and confirm before overwriting an existing file.
	if _, err := os.Stat(cfgPath); err == nil {
		_, _ = fmt.Fprintln(out)
		answer := promptLine(r, out,
			fmt.Sprintf("%s already exists. Overwrite? [y/N]", cfgPath), "N")
		if !strings.EqualFold(strings.TrimSpace(answer), "y") {
			_, _ = fmt.Fprintln(out, "Aborted — existing config unchanged.")
			return nil
		}
	}

	schema := configFileSchema{
		Version: 1,
		Server:  server,
		APIKey:  apiKey,
	}
	// Only persist web_url when it differs from server (avoids noise in prod configs).
	if webURL != server {
		schema.WebURL = webURL
	}
	data, err := yaml.Marshal(schema)
	if err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}

	_, _ = fmt.Fprintln(out)
	_, _ = fmt.Fprintf(out, "Writing %s...", cfgPath)
	if err := os.WriteFile(cfgPath, data, 0o600); err != nil {
		return fmt.Errorf("writing config: %w", err)
	}
	_, _ = fmt.Fprintln(out, " done.")
	_, _ = fmt.Fprintln(out)

	if apiKey == "" {
		_, _ = fmt.Fprintln(out, "Run 'lextures auth login' to authenticate.")
	} else {
		_, _ = fmt.Fprintln(out, "You're all set!")
	}
	return nil
}

// promptLine prints a prompt and reads one line from r.
// When the user enters nothing, defaultVal is returned.
func promptLine(r *bufio.Reader, out io.Writer, label, defaultVal string) string {
	if defaultVal != "" {
		_, _ = fmt.Fprintf(out, "%s [%s]: ", label, defaultVal)
	} else {
		_, _ = fmt.Fprintf(out, "%s: ", label)
	}
	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return defaultVal
	}
	return line
}
