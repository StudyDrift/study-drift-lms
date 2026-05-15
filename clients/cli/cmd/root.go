package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/lextures/lextures/clients/cli/internal/auth"
	"github.com/lextures/lextures/clients/cli/internal/config"
	"github.com/spf13/cobra"
)

// Build-time variables injected via -ldflags.
var (
	Version     = "0.1.0"
	BuildCommit = "dev"
)

// globalFlags holds raw flag values before config is resolved.
var globalFlags struct {
	configFile string
	profile    string
	server     string
	apiKey     string
	jsonOut    bool
	initMode   bool
	localMode  bool
}

// Cfg is the resolved configuration, available to all subcommands after
// PersistentPreRunE fires.
var Cfg *config.Config

var rootCmd = &cobra.Command{
	Use:   "lextures",
	Short: "Lextures CLI — command line interface for Lextures",
	Long: `A command line interface to manage Lextures resources.

Manage courses, assignments, users, and more from the terminal.
Configuration is loaded from ~/.lextures.yaml; flags and environment
variables (LEXTURES_SERVER, LEXTURES_API_KEY, LEXTURES_JSON) override
file values.`,
	SilenceUsage:  true,
	SilenceErrors: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		if globalFlags.initMode {
			return runInit(cmd, os.Stdin, globalFlags.localMode)
		}
		return cmd.Help()
	},
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// --init handles its own flow; skip config loading and auth.
		if globalFlags.initMode {
			return nil
		}
		cfg, err := config.Load(config.LoadOptions{
			ConfigFile: globalFlags.configFile,
			Profile:    globalFlags.profile,
			Server:     globalFlags.server,
			APIKey:     globalFlags.apiKey,
			JSON:       globalFlags.jsonOut,
		})
		if err != nil {
			return err
		}
		Cfg = cfg

		if commandNeedsAuth(cmd) && Cfg.APIKey == "" {
			mgr := auth.New(Cfg.Server)
			profile := globalFlags.profile
			if profile == "" {
				profile = "default"
			}
			tok, err := mgr.Load(profile)
			if err != nil {
				return fmt.Errorf("loading token: %w", err)
			}
			if tok == nil {
				return errNotAuthenticated
			}
			Cfg.APIKey = tok.AccessToken
		}
		return nil
	},
}

// Execute runs the root command and maps errors to the correct exit codes.
//
// Exit codes:
//
//	0  success
//	1  bad input / usage error
//	2  API / server error
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		writeError(err, 1)
		os.Exit(1)
	}
}

// writeError writes err to stderr in the correct format based on --json.
func writeError(err error, code int) {
	if globalFlags.jsonOut {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]any{
			"error": err.Error(),
			"code":  code,
		})
	} else {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
	}
}

// ExitWithError writes err and exits with code. Use exit code 2 for API errors.
func ExitWithError(err error, code int) {
	writeError(err, code)
	os.Exit(code)
}

// commandNeedsAuth returns false for any command annotated with SkipAuthAnnotation,
// including all descendants (checked by walking the parent chain).
func commandNeedsAuth(cmd *cobra.Command) bool {
	for c := cmd; c != nil; c = c.Parent() {
		if c.Annotations[SkipAuthAnnotation] == "true" {
			return false
		}
	}
	return true
}

func init() {
	rootCmd.PersistentFlags().StringVar(&globalFlags.configFile, "config", "",
		"config file (default: ~/.lextures.yaml)")
	rootCmd.PersistentFlags().StringVar(&globalFlags.profile, "profile", "",
		"named profile from config file")
	rootCmd.PersistentFlags().StringVar(&globalFlags.server, "server", "",
		"Lextures server URL (overrides config and LEXTURES_SERVER)")
	rootCmd.PersistentFlags().StringVar(&globalFlags.apiKey, "api-key", "",
		"API key (overrides config and LEXTURES_API_KEY)")
	rootCmd.PersistentFlags().BoolVar(&globalFlags.jsonOut, "json", false,
		"output results as JSON")
	rootCmd.Flags().BoolVar(&globalFlags.initMode, "init", false,
		"interactive setup: create ~/.lextures.yaml with prompted values")
	rootCmd.Flags().BoolVar(&globalFlags.localMode, "local", false,
		"when used with --init, use local Docker defaults (http://localhost:8080)")
}
