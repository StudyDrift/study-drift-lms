package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// usersServerConfig defines optional handlers for the four user-related endpoints.
type usersServerConfig struct {
	listHandler   http.HandlerFunc
	getHandler    http.HandlerFunc
	createHandler http.HandlerFunc
	enrollHandler http.HandlerFunc
}

// newUsersServer builds a minimal test server routing user and enrollment endpoints.
func newUsersServer(t *testing.T, cfg usersServerConfig) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/users":
			if cfg.listHandler != nil {
				cfg.listHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/users":
			if cfg.createHandler != nil {
				cfg.createHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/users/"):
			if cfg.getHandler != nil {
				cfg.getHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/enrollments"):
			if cfg.enrollHandler != nil {
				cfg.enrollHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
}

// sampleUser returns a minimal userPublic fixture.
func sampleUser(id, email, name, role string) userPublic {
	return userPublic{
		ID:        id,
		Email:     email,
		Name:      name,
		Role:      role,
		CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
}

// resetUsersFlags resets all users command flag state between tests.
func resetUsersFlags() {
	usersListFlags.org = ""
	usersListFlags.role = ""
	usersListFlags.limit = 50
	usersListFlags.page = 1
	usersCreateFlags.email = ""
	usersCreateFlags.name = ""
	usersCreateFlags.role = "student"
	usersEnrollFlags.course = ""
	usersEnrollFlags.user = ""
	usersEnrollFlags.role = ""
	usersEnrollFlags.dryRun = false
}

// ============================================================
// users list
// ============================================================

func TestUsersList_Success(t *testing.T) {
	users := []userPublic{
		sampleUser("uuid-1", "alice@uni.edu", "Alice", "student"),
		sampleUser("uuid-2", "bob@uni.edu", "Bob", "instructor"),
	}
	srv := newUsersServer(t, usersServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(usersListBody{Users: users})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()

	var out bytes.Buffer
	usersListCmd.SetOut(&out)
	if err := usersListCmd.RunE(usersListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "alice@uni.edu") {
		t.Errorf("output = %q; want alice@uni.edu", output)
	}
	if !strings.Contains(output, "Alice") {
		t.Errorf("output = %q; want Alice", output)
	}
	if !strings.Contains(output, "bob@uni.edu") {
		t.Errorf("output = %q; want bob@uni.edu", output)
	}
}

func TestUsersList_JSONOutput(t *testing.T) {
	users := []userPublic{sampleUser("uuid-1", "alice@uni.edu", "Alice", "student")}
	srv := newUsersServer(t, usersServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(usersListBody{Users: users})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	usersListCmd.SetOut(&out)
	if err := usersListCmd.RunE(usersListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result []map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 user, got %d", len(result))
	}
	if result[0]["email"] != "alice@uni.edu" {
		t.Errorf("email = %v, want alice@uni.edu", result[0]["email"])
	}
}

func TestUsersList_OrgFilter(t *testing.T) {
	var gotQuery string
	srv := newUsersServer(t, usersServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			gotQuery = r.URL.RawQuery
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(usersListBody{Users: nil})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersListFlags.org = "org-uuid-abc"

	usersListCmd.SetOut(&bytes.Buffer{})
	if err := usersListCmd.RunE(usersListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if !strings.Contains(gotQuery, "org=org-uuid-abc") {
		t.Errorf("query = %q; want org=org-uuid-abc", gotQuery)
	}
}

func TestUsersList_RoleFilter(t *testing.T) {
	var gotQuery string
	srv := newUsersServer(t, usersServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			gotQuery = r.URL.RawQuery
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(usersListBody{Users: nil})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersListFlags.role = "instructor"

	usersListCmd.SetOut(&bytes.Buffer{})
	if err := usersListCmd.RunE(usersListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if !strings.Contains(gotQuery, "role=instructor") {
		t.Errorf("query = %q; want role=instructor", gotQuery)
	}
}

func TestUsersList_EmptyResult(t *testing.T) {
	srv := newUsersServer(t, usersServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(usersListBody{Users: []userPublic{}})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()

	var out bytes.Buffer
	usersListCmd.SetOut(&out)
	if err := usersListCmd.RunE(usersListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if !strings.Contains(out.String(), "ID") {
		t.Errorf("expected header row, got: %q", out.String())
	}
}

func TestUsersList_ServerError(t *testing.T) {
	srv := newUsersServer(t, usersServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Access denied."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()

	err := usersListCmd.RunE(usersListCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "Access denied") {
		t.Errorf("err = %v, want Access denied", err)
	}
}

func TestUsersList_AuthorizationHeader(t *testing.T) {
	var gotAuth string
	srv := newUsersServer(t, usersServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(usersListBody{Users: nil})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "secret-key")
	resetUsersFlags()

	usersListCmd.SetOut(&bytes.Buffer{})
	if err := usersListCmd.RunE(usersListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer secret-key" {
		t.Errorf("Authorization = %q, want 'Bearer secret-key'", gotAuth)
	}
}

// ============================================================
// users get
// ============================================================

func TestUsersGet_ByUUID(t *testing.T) {
	u := sampleUser("aaaaaaaa-0000-0000-0000-000000000001", "alice@uni.edu", "Alice", "student")
	srv := newUsersServer(t, usersServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(u)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()

	var out bytes.Buffer
	usersGetCmd.SetOut(&out)
	if err := usersGetCmd.RunE(usersGetCmd, []string{"aaaaaaaa-0000-0000-0000-000000000001"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "alice@uni.edu") {
		t.Errorf("output = %q; want email", output)
	}
	if !strings.Contains(output, "Alice") {
		t.Errorf("output = %q; want name", output)
	}
}

func TestUsersGet_ByEmail(t *testing.T) {
	u := sampleUser("bbbbbbbb-0000-0000-0000-000000000002", "bob@uni.edu", "Bob", "instructor")
	srv := newUsersServer(t, usersServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			// Verify email was URL-encoded in the path.
			if !strings.Contains(r.URL.Path, "bob") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(u)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()

	var out bytes.Buffer
	usersGetCmd.SetOut(&out)
	if err := usersGetCmd.RunE(usersGetCmd, []string{"bob@uni.edu"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "bob@uni.edu") {
		t.Errorf("output = %q; want email", output)
	}
}

func TestUsersGet_JSONOutput(t *testing.T) {
	u := sampleUser("cccccccc-0000-0000-0000-000000000003", "carol@uni.edu", "Carol", "ta")
	srv := newUsersServer(t, usersServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(u)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	usersGetCmd.SetOut(&out)
	if err := usersGetCmd.RunE(usersGetCmd, []string{"carol@uni.edu"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["email"] != "carol@uni.edu" {
		t.Errorf("email = %v, want carol@uni.edu", result["email"])
	}
}

func TestUsersGet_NotFound(t *testing.T) {
	srv := newUsersServer(t, usersServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "User not found."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()

	err := usersGetCmd.RunE(usersGetCmd, []string{"nobody@uni.edu"})
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

// ============================================================
// users create
// ============================================================

func TestUsersCreate_Success(t *testing.T) {
	created := sampleUser("dddddddd-0000-0000-0000-000000000004", "jane@uni.edu", "Jane Doe", "student")
	var gotBody map[string]any
	srv := newUsersServer(t, usersServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersCreateFlags.email = "jane@uni.edu"
	usersCreateFlags.name = "Jane Doe"
	usersCreateFlags.role = "student"

	var out bytes.Buffer
	usersCreateCmd.SetOut(&out)
	if err := usersCreateCmd.RunE(usersCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if gotBody["email"] != "jane@uni.edu" {
		t.Errorf("email sent = %v, want jane@uni.edu", gotBody["email"])
	}
	if gotBody["name"] != "Jane Doe" {
		t.Errorf("name sent = %v, want Jane Doe", gotBody["name"])
	}
	if !strings.Contains(out.String(), "jane@uni.edu") {
		t.Errorf("output = %q; want email in confirmation", out.String())
	}
	if !strings.Contains(out.String(), created.ID) {
		t.Errorf("output = %q; want user ID in confirmation", out.String())
	}
}

func TestUsersCreate_JSONOutput(t *testing.T) {
	created := sampleUser("dddddddd-0000-0000-0000-000000000005", "json@uni.edu", "JSON User", "student")
	srv := newUsersServer(t, usersServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersCreateFlags.email = "json@uni.edu"
	usersCreateFlags.name = "JSON User"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	usersCreateCmd.SetOut(&out)
	if err := usersCreateCmd.RunE(usersCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["email"] != "json@uni.edu" {
		t.Errorf("email = %v, want json@uni.edu", result["email"])
	}
}

// TestUsersCreate_DuplicateEmail covers AC-2: duplicate email → error, exit 1.
func TestUsersCreate_DuplicateEmail(t *testing.T) {
	srv := newUsersServer(t, usersServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Email already in use."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersCreateFlags.email = "dup@uni.edu"
	usersCreateFlags.name = "Dup User"

	err := usersCreateCmd.RunE(usersCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for duplicate email, got nil")
	}
	if !strings.Contains(err.Error(), "dup@uni.edu") {
		t.Errorf("err = %v, want email in message", err)
	}
	if !strings.Contains(err.Error(), "already exists") {
		t.Errorf("err = %v, want 'already exists'", err)
	}
}

func TestUsersCreate_DefaultRoleIsStudent(t *testing.T) {
	var gotBody map[string]any
	srv := newUsersServer(t, usersServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(sampleUser("id-1", "x@y.com", "X", "student"))
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersCreateFlags.email = "x@y.com"
	usersCreateFlags.name = "X"
	// role is intentionally left as default ("student")

	usersCreateCmd.SetOut(&bytes.Buffer{})
	if err := usersCreateCmd.RunE(usersCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotBody["role"] != "student" {
		t.Errorf("role sent = %v, want student (default)", gotBody["role"])
	}
}

func TestUsersCreate_ServerError(t *testing.T) {
	srv := newUsersServer(t, usersServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "You do not have permission."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersCreateFlags.email = "x@y.com"
	usersCreateFlags.name = "X"

	err := usersCreateCmd.RunE(usersCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "permission") {
		t.Errorf("err = %v, want permission error", err)
	}
}

func TestUsersCreate_AuthorizationHeader(t *testing.T) {
	var gotAuth string
	srv := newUsersServer(t, usersServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(sampleUser("id-1", "x@y.com", "X", "student"))
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "my-api-key")
	resetUsersFlags()
	usersCreateFlags.email = "x@y.com"
	usersCreateFlags.name = "X"

	usersCreateCmd.SetOut(&bytes.Buffer{})
	if err := usersCreateCmd.RunE(usersCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer my-api-key" {
		t.Errorf("Authorization = %q, want 'Bearer my-api-key'", gotAuth)
	}
}

// ============================================================
// users enroll
// ============================================================

// TestUsersEnroll_ByEmail covers AC-3: enroll by email, user appears in roster.
func TestUsersEnroll_ByEmail(t *testing.T) {
	user := sampleUser("eeeeeeee-0000-0000-0000-000000000006", "student@uni.edu", "Student", "student")
	var enrollBody map[string]any
	var enrollPath string

	srv := newUsersServer(t, usersServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(user)
		},
		enrollHandler: func(w http.ResponseWriter, r *http.Request) {
			enrollPath = r.URL.Path
			_ = json.NewDecoder(r.Body).Decode(&enrollBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "enrolled"})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersEnrollFlags.course = "CS101"
	usersEnrollFlags.user = "student@uni.edu"
	usersEnrollFlags.role = "student"

	var out bytes.Buffer
	usersEnrollCmd.SetOut(&out)
	if err := usersEnrollCmd.RunE(usersEnrollCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !strings.Contains(enrollPath, "CS101") {
		t.Errorf("enroll path = %q; want CS101", enrollPath)
	}
	if enrollBody["user_id"] != user.ID {
		t.Errorf("user_id sent = %v, want %s", enrollBody["user_id"], user.ID)
	}
	if enrollBody["role"] != "student" {
		t.Errorf("role sent = %v, want student", enrollBody["role"])
	}
	if !strings.Contains(out.String(), "Student") {
		t.Errorf("output = %q; want user name", out.String())
	}
	if !strings.Contains(out.String(), "student") {
		t.Errorf("output = %q; want role", out.String())
	}
	if !strings.Contains(out.String(), "CS101") {
		t.Errorf("output = %q; want course ID", out.String())
	}
}

// TestUsersEnroll_ByUUID passes a UUID directly, skipping the user lookup.
func TestUsersEnroll_ByUUID(t *testing.T) {
	const userUUID = "ffffffff-0000-0000-0000-000000000007"
	var enrollBody map[string]any
	lookupCalled := false

	srv := newUsersServer(t, usersServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			lookupCalled = true
			http.NotFound(w, r)
		},
		enrollHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&enrollBody)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "enrolled"})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersEnrollFlags.course = "CS201"
	usersEnrollFlags.user = userUUID
	usersEnrollFlags.role = "ta"

	usersEnrollCmd.SetOut(&bytes.Buffer{})
	if err := usersEnrollCmd.RunE(usersEnrollCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if lookupCalled {
		t.Error("UUID input should not trigger a user lookup")
	}
	if enrollBody["user_id"] != userUUID {
		t.Errorf("user_id = %v, want %s", enrollBody["user_id"], userUUID)
	}
}

// TestUsersEnroll_AlreadyEnrolled covers AC-5: idempotent enroll returns exit 0 with warning.
func TestUsersEnroll_AlreadyEnrolled(t *testing.T) {
	const userUUID = "11111111-aaaa-0000-0000-000000000001"
	srv := newUsersServer(t, usersServerConfig{
		enrollHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "User already enrolled."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersEnrollFlags.course = "CS101"
	usersEnrollFlags.user = userUUID
	usersEnrollFlags.role = "student"

	var out bytes.Buffer
	usersEnrollCmd.SetOut(&out)
	// Must exit 0 (no error return).
	if err := usersEnrollCmd.RunE(usersEnrollCmd, nil); err != nil {
		t.Fatalf("expected nil error for already-enrolled, got: %v", err)
	}
	if !strings.Contains(out.String(), "already enrolled") {
		t.Errorf("output = %q; want 'already enrolled' warning", out.String())
	}
}

func TestUsersEnroll_DryRun(t *testing.T) {
	const userUUID = "22222222-bbbb-0000-0000-000000000002"
	apiCalled := false
	srv := newUsersServer(t, usersServerConfig{
		enrollHandler: func(w http.ResponseWriter, r *http.Request) {
			apiCalled = true
			w.WriteHeader(http.StatusCreated)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersEnrollFlags.course = "CS101"
	usersEnrollFlags.user = userUUID
	usersEnrollFlags.role = "student"
	usersEnrollFlags.dryRun = true

	var out bytes.Buffer
	usersEnrollCmd.SetOut(&out)
	if err := usersEnrollCmd.RunE(usersEnrollCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if apiCalled {
		t.Error("--dry-run should not call the enroll API")
	}
	if !strings.Contains(out.String(), "Would enroll") {
		t.Errorf("output = %q; want dry-run message", out.String())
	}
}

func TestUsersEnroll_JSONOutput(t *testing.T) {
	const userUUID = "33333333-cccc-0000-0000-000000000003"
	srv := newUsersServer(t, usersServerConfig{
		enrollHandler: func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "enrolled"})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersEnrollFlags.course = "CS101"
	usersEnrollFlags.user = userUUID
	usersEnrollFlags.role = "instructor"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	usersEnrollCmd.SetOut(&out)
	if err := usersEnrollCmd.RunE(usersEnrollCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["course"] != "CS101" {
		t.Errorf("course = %v, want CS101", result["course"])
	}
	if result["role"] != "instructor" {
		t.Errorf("role = %v, want instructor", result["role"])
	}
}

func TestUsersEnroll_ServerError(t *testing.T) {
	const userUUID = "44444444-dddd-0000-0000-000000000004"
	srv := newUsersServer(t, usersServerConfig{
		enrollHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Not authorized to enroll."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetUsersFlags()
	usersEnrollFlags.course = "CS101"
	usersEnrollFlags.user = userUUID
	usersEnrollFlags.role = "student"

	err := usersEnrollCmd.RunE(usersEnrollCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "Not authorized") {
		t.Errorf("err = %v, want authorization error", err)
	}
}

// ============================================================
// users command tree
// ============================================================

func TestUsersCmd_HasSubcommands(t *testing.T) {
	names := map[string]bool{}
	for _, sub := range usersCmd.Commands() {
		names[sub.Name()] = true
	}
	for _, want := range []string{"list", "get", "create", "enroll"} {
		if !names[want] {
			t.Errorf("users subcommand %q not registered", want)
		}
	}
}

func TestUsersCmd_NeedsAuth(t *testing.T) {
	if !commandNeedsAuth(usersCmd) {
		t.Error("usersCmd should require auth")
	}
	for _, sub := range usersCmd.Commands() {
		if !commandNeedsAuth(sub) {
			t.Errorf("users %s should require auth", sub.Name())
		}
	}
}

// ============================================================
// looksLikeUUID
// ============================================================

func TestLooksLikeUUID(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", true},
		{"00000000-0000-0000-0000-000000000000", true},
		{"AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE", true},
		{"not-a-uuid", false},
		{"alice@uni.edu", false},
		{"", false},
		{"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee", false}, // too short
		{"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeeee", false}, // too long
		{"aaaaaaaa-bbbbXcccc-dddd-eeeeeeeeeeee", false}, // wrong separator position
	}
	for _, tc := range cases {
		if got := looksLikeUUID(tc.input); got != tc.want {
			t.Errorf("looksLikeUUID(%q) = %v, want %v", tc.input, got, tc.want)
		}
	}
}
