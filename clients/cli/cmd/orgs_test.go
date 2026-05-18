package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// orgsServerConfig defines optional handlers for the three org-related endpoints.
type orgsServerConfig struct {
	listHandler   http.HandlerFunc
	getHandler    http.HandlerFunc
	createHandler http.HandlerFunc
}

// newOrgsServer builds a minimal test server routing org endpoints.
func newOrgsServer(t *testing.T, cfg orgsServerConfig) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/admin/orgs":
			if cfg.listHandler != nil {
				cfg.listHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/admin/orgs":
			if cfg.createHandler != nil {
				cfg.createHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/admin/orgs/"):
			if cfg.getHandler != nil {
				cfg.getHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
}

// sampleOrg returns a minimal orgPublic fixture.
func sampleOrg(id, slug, name, status string) orgPublic {
	return orgPublic{
		ID:          id,
		Slug:        slug,
		Name:        name,
		Status:      status,
		CreatedAt:   "2026-01-01T00:00:00Z",
		UserCount:   10,
		CourseCount: 3,
	}
}

// resetOrgsFlags resets flag state between tests.
func resetOrgsFlags() {
	orgsListFlags.limit = 50
	orgsListFlags.page = 1
	orgsCreateFlags.name = ""
	orgsCreateFlags.force = false
	orgsCreateInput = nil
}

// ============================================================
// orgs list
// ============================================================

func TestOrgsList_Success(t *testing.T) {
	orgs := []orgPublic{
		sampleOrg("aaaaaaaa-0000-0000-0000-000000000001", "west-side", "West Side", "active"),
		sampleOrg("bbbbbbbb-0000-0000-0000-000000000002", "east-end", "East End", "active"),
	}
	srv := newOrgsServer(t, orgsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(orgsListBody{Organizations: orgs})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()

	var out bytes.Buffer
	orgsListCmd.SetOut(&out)
	if err := orgsListCmd.RunE(orgsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "West Side") {
		t.Errorf("output = %q; want West Side", output)
	}
	if !strings.Contains(output, "west-side") {
		t.Errorf("output = %q; want west-side", output)
	}
	if !strings.Contains(output, "East End") {
		t.Errorf("output = %q; want East End", output)
	}
}

func TestOrgsList_JSONOutput(t *testing.T) {
	orgs := []orgPublic{sampleOrg("aaaaaaaa-0000-0000-0000-000000000001", "uni-a", "Uni A", "active")}
	srv := newOrgsServer(t, orgsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(orgsListBody{Organizations: orgs})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	orgsListCmd.SetOut(&out)
	if err := orgsListCmd.RunE(orgsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result []map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 org, got %d", len(result))
	}
	if result[0]["slug"] != "uni-a" {
		t.Errorf("slug = %v, want uni-a", result[0]["slug"])
	}
}

func TestOrgsList_EmptyResult(t *testing.T) {
	srv := newOrgsServer(t, orgsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(orgsListBody{Organizations: []orgPublic{}})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()

	var out bytes.Buffer
	orgsListCmd.SetOut(&out)
	if err := orgsListCmd.RunE(orgsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if !strings.Contains(out.String(), "ID") {
		t.Errorf("expected header row, got: %q", out.String())
	}
}

// TestOrgsList_PermissionDenied covers AC-2: 403 surfaces as "Permission denied".
func TestOrgsList_PermissionDenied(t *testing.T) {
	srv := newOrgsServer(t, orgsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "You do not have permission for this action."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()

	err := orgsListCmd.RunE(orgsListCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Errorf("err = %v, want 'Permission denied'", err)
	}
	if !strings.Contains(err.Error(), "super-admin") {
		t.Errorf("err = %v, want 'super-admin'", err)
	}
}

func TestOrgsList_PaginationParams(t *testing.T) {
	var gotQuery string
	srv := newOrgsServer(t, orgsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			gotQuery = r.URL.RawQuery
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(orgsListBody{Organizations: nil})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	orgsListFlags.limit = 10
	orgsListFlags.page = 3

	orgsListCmd.SetOut(&bytes.Buffer{})
	if err := orgsListCmd.RunE(orgsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !strings.Contains(gotQuery, "limit=10") {
		t.Errorf("query = %q; want limit=10", gotQuery)
	}
	if !strings.Contains(gotQuery, "offset=20") {
		t.Errorf("query = %q; want offset=20 (page 3, limit 10)", gotQuery)
	}
}

func TestOrgsList_AuthorizationHeader(t *testing.T) {
	var gotAuth string
	srv := newOrgsServer(t, orgsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(orgsListBody{Organizations: nil})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "admin-key")
	resetOrgsFlags()

	orgsListCmd.SetOut(&bytes.Buffer{})
	if err := orgsListCmd.RunE(orgsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer admin-key" {
		t.Errorf("Authorization = %q, want 'Bearer admin-key'", gotAuth)
	}
}

// ============================================================
// orgs get
// ============================================================

func TestOrgsGet_ByUUID(t *testing.T) {
	org := sampleOrg("cccccccc-0000-0000-0000-000000000003", "acme-u", "Acme University", "active")
	srv := newOrgsServer(t, orgsServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(org)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()

	var out bytes.Buffer
	orgsGetCmd.SetOut(&out)
	if err := orgsGetCmd.RunE(orgsGetCmd, []string{"cccccccc-0000-0000-0000-000000000003"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "Acme University") {
		t.Errorf("output = %q; want org name", output)
	}
	if !strings.Contains(output, "acme-u") {
		t.Errorf("output = %q; want slug", output)
	}
}

func TestOrgsGet_BySlug(t *testing.T) {
	orgs := []orgPublic{
		sampleOrg("dddddddd-0000-0000-0000-000000000004", "river-college", "River College", "active"),
	}
	srv := newOrgsServer(t, orgsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(orgsListBody{Organizations: orgs})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()

	var out bytes.Buffer
	orgsGetCmd.SetOut(&out)
	if err := orgsGetCmd.RunE(orgsGetCmd, []string{"river-college"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "River College") {
		t.Errorf("output = %q; want org name", output)
	}
}

func TestOrgsGet_JSONOutput(t *testing.T) {
	org := sampleOrg("eeeeeeee-0000-0000-0000-000000000005", "json-org", "JSON Org", "active")
	srv := newOrgsServer(t, orgsServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(org)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	orgsGetCmd.SetOut(&out)
	if err := orgsGetCmd.RunE(orgsGetCmd, []string{"eeeeeeee-0000-0000-0000-000000000005"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["slug"] != "json-org" {
		t.Errorf("slug = %v, want json-org", result["slug"])
	}
}

func TestOrgsGet_NotFound(t *testing.T) {
	srv := newOrgsServer(t, orgsServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Not found."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()

	err := orgsGetCmd.RunE(orgsGetCmd, []string{"ffffffff-0000-0000-0000-000000000099"})
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

func TestOrgsGet_SlugNotFound(t *testing.T) {
	srv := newOrgsServer(t, orgsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(orgsListBody{Organizations: []orgPublic{}})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()

	err := orgsGetCmd.RunE(orgsGetCmd, []string{"no-such-slug"})
	if err == nil {
		t.Fatal("expected error for unknown slug, got nil")
	}
	if !strings.Contains(err.Error(), "no-such-slug") {
		t.Errorf("err = %v, want slug in error", err)
	}
}

func TestOrgsGet_PermissionDenied(t *testing.T) {
	srv := newOrgsServer(t, orgsServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "You do not have permission for this action."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()

	err := orgsGetCmd.RunE(orgsGetCmd, []string{"aaaaaaaa-0000-0000-0000-000000000001"})
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Errorf("err = %v, want 'Permission denied'", err)
	}
}

// ============================================================
// orgs create
// ============================================================

func TestOrgsCreate_Success(t *testing.T) {
	created := sampleOrg("11111111-0000-0000-0000-000000000001", "west-side-sd", "West Side School District", "active")
	var gotBody map[string]any

	srv := newOrgsServer(t, orgsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	orgsCreateFlags.name = "West Side School District"
	orgsCreateFlags.force = true

	var out bytes.Buffer
	orgsCreateCmd.SetOut(&out)
	if err := orgsCreateCmd.RunE(orgsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if gotBody["name"] != "West Side School District" {
		t.Errorf("name sent = %v, want West Side School District", gotBody["name"])
	}
	output := out.String()
	if !strings.Contains(output, "West Side School District") {
		t.Errorf("output = %q; want org name in confirmation", output)
	}
	if !strings.Contains(output, created.ID) {
		t.Errorf("output = %q; want org ID in confirmation", output)
	}
	if !strings.Contains(output, "west-side-sd") {
		t.Errorf("output = %q; want slug in confirmation", output)
	}
}

func TestOrgsCreate_JSONOutput(t *testing.T) {
	created := sampleOrg("22222222-0000-0000-0000-000000000002", "json-school", "JSON School", "active")
	srv := newOrgsServer(t, orgsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	orgsCreateFlags.name = "JSON School"
	orgsCreateFlags.force = true
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	orgsCreateCmd.SetOut(&out)
	if err := orgsCreateCmd.RunE(orgsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["slug"] != "json-school" {
		t.Errorf("slug = %v, want json-school", result["slug"])
	}
}

func TestOrgsCreate_ConfirmationPrompt_Aborted(t *testing.T) {
	apiCalled := false
	srv := newOrgsServer(t, orgsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			apiCalled = true
			w.WriteHeader(http.StatusCreated)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	orgsCreateFlags.name = "Test Org"
	orgsCreateFlags.force = false
	orgsCreateInput = strings.NewReader("n\n")

	var out bytes.Buffer
	orgsCreateCmd.SetOut(&out)
	if err := orgsCreateCmd.RunE(orgsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if apiCalled {
		t.Error("create API should not be called when user aborts")
	}
	if !strings.Contains(out.String(), "Aborted") {
		t.Errorf("output = %q; want 'Aborted'", out.String())
	}
}

func TestOrgsCreate_ConfirmationPrompt_Confirmed(t *testing.T) {
	created := sampleOrg("33333333-0000-0000-0000-000000000003", "test-org", "Test Org", "active")
	srv := newOrgsServer(t, orgsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	orgsCreateFlags.name = "Test Org"
	orgsCreateFlags.force = false
	orgsCreateInput = strings.NewReader("y\n")

	var out bytes.Buffer
	orgsCreateCmd.SetOut(&out)
	if err := orgsCreateCmd.RunE(orgsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !strings.Contains(out.String(), "Created org") {
		t.Errorf("output = %q; want created confirmation", out.String())
	}
}

func TestOrgsCreate_SlugConflict(t *testing.T) {
	srv := newOrgsServer(t, orgsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "That slug is already in use."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	orgsCreateFlags.name = "Dup Org"
	orgsCreateFlags.force = true

	err := orgsCreateCmd.RunE(orgsCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for conflict, got nil")
	}
	if !strings.Contains(err.Error(), "slug already exists") {
		t.Errorf("err = %v, want slug conflict message", err)
	}
}

func TestOrgsCreate_PermissionDenied(t *testing.T) {
	srv := newOrgsServer(t, orgsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "You do not have permission for this action."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetOrgsFlags()
	orgsCreateFlags.name = "Forbidden Org"
	orgsCreateFlags.force = true

	err := orgsCreateCmd.RunE(orgsCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Errorf("err = %v, want 'Permission denied'", err)
	}
}

func TestOrgsCreate_AuthorizationHeader(t *testing.T) {
	var gotAuth string
	created := sampleOrg("44444444-0000-0000-0000-000000000004", "auth-org", "Auth Org", "active")
	srv := newOrgsServer(t, orgsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "super-admin-key")
	resetOrgsFlags()
	orgsCreateFlags.name = "Auth Org"
	orgsCreateFlags.force = true

	orgsCreateCmd.SetOut(&bytes.Buffer{})
	if err := orgsCreateCmd.RunE(orgsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer super-admin-key" {
		t.Errorf("Authorization = %q, want 'Bearer super-admin-key'", gotAuth)
	}
}

// ============================================================
// orgs command tree
// ============================================================

func TestOrgsCmd_HasSubcommands(t *testing.T) {
	names := map[string]bool{}
	for _, sub := range orgsCmd.Commands() {
		names[sub.Name()] = true
	}
	for _, want := range []string{"list", "get", "create"} {
		if !names[want] {
			t.Errorf("orgs subcommand %q not registered", want)
		}
	}
}

func TestOrgsCmd_NeedsAuth(t *testing.T) {
	if !commandNeedsAuth(orgsCmd) {
		t.Error("orgsCmd should require auth")
	}
	for _, sub := range orgsCmd.Commands() {
		if !commandNeedsAuth(sub) {
			t.Errorf("orgs %s should require auth", sub.Name())
		}
	}
}
