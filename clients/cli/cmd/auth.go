package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/lextures/lextures/clients/cli/internal/auth"
	"github.com/spf13/cobra"
)

// SkipAuthAnnotation marks a command (and its subtree) as not requiring a
// stored token. Checked by commandNeedsAuth in root.go.
const SkipAuthAnnotation = "skipAuth"

var authCmd = &cobra.Command{
	Use:         "auth",
	Short:       "Manage Lextures authentication",
	Annotations: map[string]string{SkipAuthAnnotation: "true"},
}

var authLoginCmd = &cobra.Command{
	Use:   "login",
	Short: "Log in to Lextures via browser",
	RunE:  runAuthLogin,
}

var authLogoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Clear stored credentials",
	RunE:  runAuthLogout,
}

var authStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show current authentication status",
	RunE:  runAuthStatus,
}

func init() {
	authCmd.AddCommand(authLoginCmd, authLogoutCmd, authStatusCmd)
	rootCmd.AddCommand(authCmd)
}

func activeProfile() string {
	if globalFlags.profile != "" {
		return globalFlags.profile
	}
	return "default"
}

func runAuthLogin(cmd *cobra.Command, args []string) error {
	// Request a pending CLI auth session from the server.
	resp, err := http.Post(Cfg.Server+"/api/v1/auth/cli/request", "application/json", bytes.NewReader([]byte("{}")))
	if err != nil {
		return fmt.Errorf("requesting CLI auth session: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	var sessionResp struct {
		Token     string `json:"token"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sessionResp); err != nil {
		return fmt.Errorf("decoding session response: %w", err)
	}

	webURL := strings.TrimRight(Cfg.WebURL, "/")
	approveURL := webURL + "/cli-auth?token=" + sessionResp.Token

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Opening your browser to complete login...")
	_, _ = fmt.Fprintln(cmd.OutOrStdout())
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "  %s\n", approveURL)
	_, _ = fmt.Fprintln(cmd.OutOrStdout())
	_, _ = fmt.Fprintln(cmd.OutOrStdout(), "If it did not open automatically, copy the URL above into your browser.")

	_ = openBrowser(approveURL)

	tok, err := pollCLIAuth(Cfg.Server, sessionResp.Token, sessionResp.ExpiresIn)
	if err != nil {
		return err
	}

	mgr := auth.New(Cfg.Server)
	if err := mgr.Save(activeProfile(), tok); err != nil {
		return fmt.Errorf("saving token: %w", err)
	}

	_, _ = fmt.Fprintln(cmd.OutOrStdout(), "\nLogged in successfully.")
	return nil
}

// cliAuthPollInterval can be overridden in tests to avoid sleeping.
var cliAuthPollInterval = 3 * time.Second

func pollCLIAuth(server, token string, expiresIn int) (*auth.TokenData, error) {
	spinFrames := []string{"|", "/", "-", "\\"}
	ttl := time.Duration(expiresIn) * time.Second
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	deadline := time.Now().Add(ttl)

	for i := 0; time.Now().Before(deadline); i++ {
		time.Sleep(cliAuthPollInterval)
		_, _ = fmt.Printf("\r%s Waiting for browser approval...", spinFrames[i%len(spinFrames)])

		resp, err := http.Get(server + "/api/v1/auth/cli/poll?token=" + token)
		if err != nil {
			continue
		}
		var r struct {
			Status       string `json:"status"`
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int    `json:"expires_in"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&r)
		_ = resp.Body.Close()

		if resp.StatusCode == http.StatusNotFound {
			return nil, fmt.Errorf("CLI auth session expired")
		}
		if r.Status == "approved" {
			_, _ = fmt.Print("\r                                         \r")
			expiry := time.Time{}
			if r.ExpiresIn > 0 {
				expiry = time.Now().Add(time.Duration(r.ExpiresIn) * time.Second)
			}
			return &auth.TokenData{
				AccessToken:  r.AccessToken,
				RefreshToken: r.RefreshToken,
				Expiry:       expiry,
			}, nil
		}
	}
	return nil, fmt.Errorf("login timed out — session expired")
}

// openBrowser tries to open url in the default browser.
func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

func runAuthLogout(cmd *cobra.Command, args []string) error {
	mgr := auth.New(Cfg.Server)
	if err := mgr.Delete(activeProfile()); err != nil {
		return fmt.Errorf("clearing token: %w", err)
	}
	_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Logged out.")
	return nil
}

// errNotAuthenticated is returned by auth status (and injected by PersistentPreRunE
// for resource commands) when no valid token is found.
var errNotAuthenticated = errors.New("not authenticated, run 'lextures auth login'")

func runAuthStatus(cmd *cobra.Command, args []string) error {
	// API key takes priority over stored token.
	if Cfg.APIKey != "" {
		me, err := fetchMe(Cfg.Server, Cfg.APIKey)
		if err != nil {
			_, _ = fmt.Fprintf(cmd.ErrOrStderr(), "API key set; could not fetch identity: %v\n", err)
			return nil
		}
		return printIdentity(cmd, me, nil, "api_key")
	}

	mgr := auth.New(Cfg.Server)
	tok, err := mgr.Load(activeProfile())
	if err != nil {
		return fmt.Errorf("loading token: %w", err)
	}
	if tok == nil {
		return errNotAuthenticated
	}

	me, err := fetchMe(Cfg.Server, tok.AccessToken)
	if err != nil {
		_, _ = fmt.Fprintf(cmd.ErrOrStderr(), "Token loaded (backend: %s); could not fetch identity: %v\n",
			mgr.Backend(), err)
		return nil
	}
	return printIdentity(cmd, me, &tok.Expiry, mgr.Backend())
}

type meResponse struct {
	Email       string  `json:"email"`
	DisplayName *string `json:"displayName"`
	AccountType string  `json:"accountType"`
}

func fetchMe(server, token string) (*meResponse, error) {
	req, err := http.NewRequest(http.MethodGet, server+"/api/v1/settings/account", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	var me meResponse
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		return nil, err
	}
	return &me, nil
}

func printIdentity(cmd *cobra.Command, me *meResponse, expiry *time.Time, backend string) error {
	name := ""
	if me.DisplayName != nil {
		name = *me.DisplayName
	}
	if globalFlags.jsonOut {
		out := map[string]any{
			"email":        me.Email,
			"display_name": name,
			"account_type": me.AccountType,
			"backend":      backend,
		}
		if expiry != nil {
			out["expiry"] = expiry.Format(time.RFC3339)
		}
		return json.NewEncoder(cmd.OutOrStdout()).Encode(out)
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Email:   %s\nName:    %s\nBackend: %s\n",
		me.Email, name, backend)
	if expiry != nil {
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Expiry:  %s\n", expiry.Format(time.RFC3339))
	}
	return nil
}
