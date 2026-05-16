package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lextures/lextures/clients/cli/internal/auth"
	"github.com/lextures/lextures/clients/cli/internal/config"
	"github.com/spf13/cobra"
)

func init() {
	// Make poll loop instant in tests.
	cliAuthPollInterval = 0
}

// newMeServer returns a test server that handles GET /api/v1/settings/account.
func newMeServer(t *testing.T, email, displayName, _ string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/settings/account" {
			http.NotFound(w, r)
			return
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"email":       email,
			"displayName": displayName,
			"accountType": "standard",
		})
	}))
}

// prepFileStore writes tok to a temp token file, sets HOME to the temp dir,
// and forces LEXTURES_TOKEN_BACKEND=file so auth.New() uses the file store.
// Returns the temp dir path.
func prepFileStore(t *testing.T, profile string, tok *auth.TokenData) string {
	t.Helper()
	dir := t.TempDir()
	store := auth.NewFileStoreAt(filepath.Join(dir, ".lextures-token"))
	if err := store.Save(profile, tok); err != nil {
		t.Fatalf("prepFileStore: %v", err)
	}
	t.Setenv("HOME", dir)
	t.Setenv("LEXTURES_TOKEN_BACKEND", "file")
	return dir
}

// setCfg is a test helper to populate the Cfg global.
func setCfg(server, apiKey string) {
	Cfg = &config.Config{Server: server, APIKey: apiKey}
}

// --- Annotation tests ---

func TestSkipAuthAnnotation_AuthCmd(t *testing.T) {
	if authCmd.Annotations[SkipAuthAnnotation] != "true" {
		t.Errorf("authCmd missing %s=true annotation", SkipAuthAnnotation)
	}
}

func TestSkipAuthAnnotation_VersionCmd(t *testing.T) {
	if versionCmd.Annotations[SkipAuthAnnotation] != "true" {
		t.Errorf("versionCmd missing %s=true annotation", SkipAuthAnnotation)
	}
}

func TestCommandNeedsAuth_AuthSubtree(t *testing.T) {
	cmds := []*cobra.Command{authCmd, authLoginCmd, authLogoutCmd, authStatusCmd}
	for _, c := range cmds {
		if commandNeedsAuth(c) {
			t.Errorf("%s should not need auth", c.Name())
		}
	}
}

func TestCommandNeedsAuth_VersionSkips(t *testing.T) {
	if commandNeedsAuth(versionCmd) {
		t.Error("versionCmd should not need auth")
	}
}

// --- auth status ---

func TestAuthStatus_APIKey_FetchesIdentity(t *testing.T) {
	srv := newMeServer(t, "apikey@example.com", "Alice", "org-1")
	defer srv.Close()

	setCfg(srv.URL, "test-api-key")

	var out bytes.Buffer
	authStatusCmd.SetOut(&out)
	if err := authStatusCmd.RunE(authStatusCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !strings.Contains(out.String(), "apikey@example.com") {
		t.Errorf("output = %q; want email", out.String())
	}
	if !strings.Contains(out.String(), "api_key") {
		t.Errorf("output = %q; want backend=api_key", out.String())
	}
}

func TestAuthStatus_StoredToken_FetchesIdentity(t *testing.T) {
	srv := newMeServer(t, "stored@example.com", "Bob", "org-2")
	defer srv.Close()

	tok := &auth.TokenData{
		AccessToken: "stored-access",
		Expiry:      time.Now().Add(time.Hour),
	}
	prepFileStore(t, "default", tok)
	setCfg(srv.URL, "")
	globalFlags.profile = ""

	var out bytes.Buffer
	authStatusCmd.SetOut(&out)
	if err := authStatusCmd.RunE(authStatusCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !strings.Contains(out.String(), "stored@example.com") {
		t.Errorf("output = %q; want stored@example.com", out.String())
	}
}

func TestAuthStatus_NoToken_ReturnsNotAuthenticated(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("LEXTURES_TOKEN_BACKEND", "file")

	setCfg("http://localhost:0", "")
	globalFlags.profile = ""

	err := authStatusCmd.RunE(authStatusCmd, nil)
	if err == nil {
		t.Fatal("expected errNotAuthenticated, got nil")
	}
	if !errors.Is(err, errNotAuthenticated) {
		t.Errorf("err = %v, want errNotAuthenticated", err)
	}
	if !strings.Contains(err.Error(), "lextures auth login") {
		t.Errorf("error message missing hint: %v", err)
	}
}

func TestAuthStatus_JSONOutput(t *testing.T) {
	srv := newMeServer(t, "json@example.com", "Charlie", "org-3")
	defer srv.Close()

	setCfg(srv.URL, "json-key")
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	authStatusCmd.SetOut(&out)
	if err := authStatusCmd.RunE(authStatusCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["email"] != "json@example.com" {
		t.Errorf("email = %v, want json@example.com", result["email"])
	}
	if result["backend"] != "api_key" {
		t.Errorf("backend = %v, want api_key", result["backend"])
	}
}

// --- auth logout ---

func TestAuthLogout_ClearsToken(t *testing.T) {
	tok := &auth.TokenData{
		AccessToken: "to-be-cleared",
		Expiry:      time.Now().Add(time.Hour),
	}
	dir := prepFileStore(t, "default", tok)
	setCfg("http://localhost:0", "")
	globalFlags.profile = ""

	var out bytes.Buffer
	authLogoutCmd.SetOut(&out)
	if err := authLogoutCmd.RunE(authLogoutCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !strings.Contains(out.String(), "Logged out") {
		t.Errorf("output = %q; want 'Logged out'", out.String())
	}

	store := auth.NewFileStoreAt(filepath.Join(dir, ".lextures-token"))
	got, _ := store.Load("default")
	if got != nil {
		t.Errorf("token still present after logout: %+v", got)
	}
}

func TestAuthLogout_NoToken_Succeeds(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("LEXTURES_TOKEN_BACKEND", "file")
	setCfg("http://localhost:0", "")
	globalFlags.profile = ""

	var out bytes.Buffer
	authLogoutCmd.SetOut(&out)
	if err := authLogoutCmd.RunE(authLogoutCmd, nil); err != nil {
		t.Fatalf("logout with no token should not error: %v", err)
	}
	if !strings.Contains(out.String(), "Logged out") {
		t.Errorf("output = %q; want 'Logged out'", out.String())
	}
}

// --- auth login (browser flow) ---

// newCLIAuthServer returns a test server that simulates the CLI auth endpoints.
// After requestCount requests to /request, poll returns "approved" with the given tokens.
func newCLIAuthServer(t *testing.T, pendingPolls int, accessToken, refreshToken string) *httptest.Server {
	t.Helper()
	var polls int
	const token = "test-cli-token"
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v1/auth/cli/request" && r.Method == http.MethodPost:
			_ = json.NewEncoder(w).Encode(map[string]any{"token": token, "expires_in": 600})
		case r.URL.Path == "/api/v1/auth/cli/poll" && r.Method == http.MethodGet:
			polls++
			if polls <= pendingPolls {
				_ = json.NewEncoder(w).Encode(map[string]string{"status": "pending"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":        "approved",
				"access_token":  accessToken,
				"refresh_token": refreshToken,
				"expires_in":    900,
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestAuthLogin_ImmediateApproval(t *testing.T) {
	srv := newCLIAuthServer(t, 0, "acc-tok", "ref-tok")
	defer srv.Close()

	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("LEXTURES_TOKEN_BACKEND", "file")
	Cfg = &config.Config{Server: srv.URL, WebURL: srv.URL}
	globalFlags.profile = ""

	var out bytes.Buffer
	authLoginCmd.SetOut(&out)
	if err := authLoginCmd.RunE(authLoginCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if !strings.Contains(out.String(), "Logged in") {
		t.Errorf("output = %q; want 'Logged in'", out.String())
	}

	store := auth.NewFileStoreAt(filepath.Join(dir, ".lextures-token"))
	tok, err := store.Load("default")
	if err != nil {
		t.Fatalf("load token: %v", err)
	}
	if tok == nil || tok.AccessToken != "acc-tok" {
		t.Errorf("stored token = %+v, want acc-tok", tok)
	}
}

func TestAuthLogin_PendingThenApproved(t *testing.T) {
	srv := newCLIAuthServer(t, 2, "delayed-tok", "")
	defer srv.Close()

	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("LEXTURES_TOKEN_BACKEND", "file")
	Cfg = &config.Config{Server: srv.URL, WebURL: srv.URL}
	globalFlags.profile = ""

	var out bytes.Buffer
	authLoginCmd.SetOut(&out)
	if err := authLoginCmd.RunE(authLoginCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	store := auth.NewFileStoreAt(filepath.Join(dir, ".lextures-token"))
	tok, err := store.Load("default")
	if err != nil {
		t.Fatalf("load token: %v", err)
	}
	if tok == nil || tok.AccessToken != "delayed-tok" {
		t.Errorf("stored token = %+v, want delayed-tok", tok)
	}
}

func TestAuthLogin_RequestFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("LEXTURES_TOKEN_BACKEND", "file")
	Cfg = &config.Config{Server: srv.URL, WebURL: srv.URL}
	globalFlags.profile = ""

	err := authLoginCmd.RunE(authLoginCmd, nil)
	if err == nil {
		t.Fatal("expected error for server 500")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("err = %v, want 500 mention", err)
	}
}

// --- PersistentPreRunE auth gate ---

func TestPersistentPreRunE_RequiresAuth(t *testing.T) {
	// Build a dummy resource command (would need auth).
	dummyCmd := &cobra.Command{
		Use:  "dummy",
		RunE: func(cmd *cobra.Command, args []string) error { return nil },
	}
	rootCmd.AddCommand(dummyCmd)
	defer func() { rootCmd.RemoveCommand(dummyCmd) }()

	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("LEXTURES_API_KEY", "")
	t.Setenv("LEXTURES_SERVER", "http://localhost:0")
	t.Setenv("LEXTURES_TOKEN_BACKEND", "file")
	globalFlags.apiKey = ""
	globalFlags.profile = ""

	rootCmd.SetArgs([]string{"dummy"})
	err := rootCmd.Execute()
	if err == nil {
		t.Fatal("expected not-authenticated error")
	}
	if !errors.Is(err, errNotAuthenticated) {
		t.Errorf("err = %v, want errNotAuthenticated", err)
	}
}

func TestPersistentPreRunE_BypassWithAPIKey(t *testing.T) {
	var called bool
	dummyCmd := &cobra.Command{
		Use:  "dummy2",
		RunE: func(cmd *cobra.Command, args []string) error { called = true; return nil },
	}
	rootCmd.AddCommand(dummyCmd)
	defer func() { rootCmd.RemoveCommand(dummyCmd) }()

	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("LEXTURES_API_KEY", "my-key")
	t.Setenv("LEXTURES_SERVER", "http://localhost:0")
	t.Setenv("LEXTURES_TOKEN_BACKEND", "file")
	globalFlags.apiKey = ""
	globalFlags.profile = ""

	rootCmd.SetArgs([]string{"dummy2"})
	if err := rootCmd.Execute(); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !called {
		t.Error("dummy2 command was not called")
	}
}
