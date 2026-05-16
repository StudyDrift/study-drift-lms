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

// newCoursesServer builds a minimal test server that handles the four course endpoints.
// Each handler is optional; pass nil to get a 404 for that method.
type coursesServerConfig struct {
	listHandler    http.HandlerFunc
	getHandler     http.HandlerFunc
	createHandler  http.HandlerFunc
	deleteHandler  http.HandlerFunc // handles PATCH /{code}/archived
}

func newCoursesServer(t *testing.T, cfg coursesServerConfig) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/courses":
			if cfg.listHandler != nil {
				cfg.listHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/courses":
			if cfg.createHandler != nil {
				cfg.createHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/courses/"):
			if cfg.getHandler != nil {
				cfg.getHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPatch && strings.HasSuffix(r.URL.Path, "/archived"):
			if cfg.deleteHandler != nil {
				cfg.deleteHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
}

// sampleCourse returns a minimal coursePublic fixture.
func sampleCourse(code, title string) coursePublic {
	return coursePublic{
		ID:         "11111111-0000-0000-0000-000000000001",
		CourseCode: code,
		Title:      title,
		Published:  true,
		Archived:   false,
		CourseType: "traditional",
		CreatedAt:  time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:  time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
	}
}

// resetCoursesFlags resets flag state between tests.
func resetCoursesFlags() {
	coursesListFlags.term = ""
	coursesListFlags.limit = 50
	coursesListFlags.page = 1
	coursesCreateFlags.title = ""
	coursesCreateFlags.description = ""
	coursesCreateFlags.orgUnitID = ""
	coursesCreateFlags.termID = ""
	coursesCreateFlags.courseType = "traditional"
	coursesDeleteFlags.force = false
	coursesDeleteInput = nil
}

// ============================================================
// courses list
// ============================================================

func TestCoursesList_Success(t *testing.T) {
	courses := []coursePublic{sampleCourse("CS101", "Intro to CS"), sampleCourse("CS201", "Data Structures")}
	srv := newCoursesServer(t, coursesServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(coursesListBody{Courses: courses})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()

	var out bytes.Buffer
	coursesListCmd.SetOut(&out)
	if err := coursesListCmd.RunE(coursesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "CS101") {
		t.Errorf("output = %q; want CS101", output)
	}
	if !strings.Contains(output, "Intro to CS") {
		t.Errorf("output = %q; want course title", output)
	}
	if !strings.Contains(output, "CS201") {
		t.Errorf("output = %q; want CS201", output)
	}
}

func TestCoursesList_JSONOutput(t *testing.T) {
	courses := []coursePublic{sampleCourse("CS101", "Intro to CS")}
	srv := newCoursesServer(t, coursesServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(coursesListBody{Courses: courses})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	coursesListCmd.SetOut(&out)
	if err := coursesListCmd.RunE(coursesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result []map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 course, got %d", len(result))
	}
	if result[0]["courseCode"] != "CS101" {
		t.Errorf("courseCode = %v, want CS101", result[0]["courseCode"])
	}
}

func TestCoursesList_TermFilter(t *testing.T) {
	var gotQuery string
	srv := newCoursesServer(t, coursesServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			gotQuery = r.URL.RawQuery
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(coursesListBody{Courses: nil})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesListFlags.term = "term-uuid-123"

	coursesListCmd.SetOut(&bytes.Buffer{})
	if err := coursesListCmd.RunE(coursesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if !strings.Contains(gotQuery, "term_id=term-uuid-123") {
		t.Errorf("query = %q; want term_id=term-uuid-123", gotQuery)
	}
}

func TestCoursesList_EmptyResult(t *testing.T) {
	srv := newCoursesServer(t, coursesServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(coursesListBody{Courses: []coursePublic{}})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()

	var out bytes.Buffer
	coursesListCmd.SetOut(&out)
	if err := coursesListCmd.RunE(coursesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	// Header row should still appear.
	if !strings.Contains(out.String(), "CODE") {
		t.Errorf("expected header row, got: %q", out.String())
	}
}

func TestCoursesList_ServerError(t *testing.T) {
	srv := newCoursesServer(t, coursesServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Invalid org ID"})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()

	err := coursesListCmd.RunE(coursesListCmd, nil)
	if err == nil {
		t.Fatal("expected error for server 400, got nil")
	}
	if !strings.Contains(err.Error(), "Invalid org ID") {
		t.Errorf("err = %v, want message about Invalid org ID", err)
	}
}

func TestCoursesList_Pagination(t *testing.T) {
	courses := make([]coursePublic, 5)
	for i := range courses {
		courses[i] = sampleCourse(
			"CODE"+string(rune('A'+i)),
			"Course "+string(rune('A'+i)),
		)
	}
	srv := newCoursesServer(t, coursesServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(coursesListBody{Courses: courses})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesListFlags.limit = 2
	coursesListFlags.page = 2 // page 2: items [2,3]

	var out bytes.Buffer
	coursesListCmd.SetOut(&out)
	if err := coursesListCmd.RunE(coursesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	output := out.String()
	if strings.Contains(output, "CODEA") || strings.Contains(output, "CODEB") {
		t.Errorf("page 2 should not show page-1 items; output = %q", output)
	}
	if !strings.Contains(output, "CODEC") {
		t.Errorf("page 2 should show CODEC; output = %q", output)
	}
}

// ============================================================
// courses get
// ============================================================

func TestCoursesGet_Success(t *testing.T) {
	co := sampleCourse("CS101", "Intro to CS")
	srv := newCoursesServer(t, coursesServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasSuffix(r.URL.Path, "/CS101") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(co)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()

	var out bytes.Buffer
	coursesGetCmd.SetOut(&out)
	if err := coursesGetCmd.RunE(coursesGetCmd, []string{"CS101"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "CS101") {
		t.Errorf("output = %q; want course code", output)
	}
	if !strings.Contains(output, "Intro to CS") {
		t.Errorf("output = %q; want course title", output)
	}
}

func TestCoursesGet_JSONOutput(t *testing.T) {
	co := sampleCourse("CS101", "Intro to CS")
	srv := newCoursesServer(t, coursesServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(co)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	coursesGetCmd.SetOut(&out)
	if err := coursesGetCmd.RunE(coursesGetCmd, []string{"CS101"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["courseCode"] != "CS101" {
		t.Errorf("courseCode = %v, want CS101", result["courseCode"])
	}
}

func TestCoursesGet_NotFound(t *testing.T) {
	srv := newCoursesServer(t, coursesServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Course not found."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()

	err := coursesGetCmd.RunE(coursesGetCmd, []string{"MISSING"})
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

// ============================================================
// courses create
// ============================================================

func TestCoursesCreate_Success(t *testing.T) {
	co := sampleCourse("CS301", "Algorithms")
	var gotBody map[string]any
	srv := newCoursesServer(t, coursesServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(co)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesCreateFlags.title = "Algorithms"
	coursesCreateFlags.courseType = "traditional"

	var out bytes.Buffer
	coursesCreateCmd.SetOut(&out)
	if err := coursesCreateCmd.RunE(coursesCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if gotBody["title"] != "Algorithms" {
		t.Errorf("title sent = %v, want Algorithms", gotBody["title"])
	}
	if !strings.Contains(out.String(), "CS301") {
		t.Errorf("output = %q; want new course code", out.String())
	}
}

func TestCoursesCreate_JSONOutput(t *testing.T) {
	co := sampleCourse("CS301", "Algorithms")
	srv := newCoursesServer(t, coursesServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(co)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesCreateFlags.title = "Algorithms"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	coursesCreateCmd.SetOut(&out)
	if err := coursesCreateCmd.RunE(coursesCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["courseCode"] != "CS301" {
		t.Errorf("courseCode = %v, want CS301", result["courseCode"])
	}
}

func TestCoursesCreate_WithOptionalFlags(t *testing.T) {
	var gotBody map[string]any
	srv := newCoursesServer(t, coursesServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(sampleCourse("CS301", "Algorithms"))
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesCreateFlags.title = "Algorithms"
	coursesCreateFlags.description = "A classic course"
	coursesCreateFlags.orgUnitID = "ou-uuid-1"
	coursesCreateFlags.termID = "term-uuid-1"
	coursesCreateFlags.courseType = "competency_based"

	coursesCreateCmd.SetOut(&bytes.Buffer{})
	if err := coursesCreateCmd.RunE(coursesCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	checks := map[string]string{
		"description": "A classic course",
		"orgUnitId":   "ou-uuid-1",
		"termId":      "term-uuid-1",
		"courseType":  "competency_based",
	}
	for field, want := range checks {
		if got, _ := gotBody[field].(string); got != want {
			t.Errorf("body[%s] = %q, want %q", field, got, want)
		}
	}
}

func TestCoursesCreate_ServerError(t *testing.T) {
	srv := newCoursesServer(t, coursesServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "You do not have permission for this action."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesCreateFlags.title = "Forbidden Course"

	err := coursesCreateCmd.RunE(coursesCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "permission") {
		t.Errorf("err = %v, want permission error", err)
	}
}

// ============================================================
// courses delete
// ============================================================

func TestCoursesDelete_Force(t *testing.T) {
	var archivedPath string
	srv := newCoursesServer(t, coursesServerConfig{
		deleteHandler: func(w http.ResponseWriter, r *http.Request) {
			archivedPath = r.URL.Path
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"courseCode": "CS101", "archived": true})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesDeleteFlags.force = true

	var out bytes.Buffer
	coursesDeleteCmd.SetOut(&out)
	if err := coursesDeleteCmd.RunE(coursesDeleteCmd, []string{"CS101"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if archivedPath != "/api/v1/courses/CS101/archived" {
		t.Errorf("path = %q, want /api/v1/courses/CS101/archived", archivedPath)
	}
	if !strings.Contains(out.String(), "CS101") {
		t.Errorf("output = %q; want course code in message", out.String())
	}
}

func TestCoursesDelete_ConfirmYes(t *testing.T) {
	archived := false
	srv := newCoursesServer(t, coursesServerConfig{
		deleteHandler: func(w http.ResponseWriter, r *http.Request) {
			archived = true
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"archived": true})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesDeleteInput = strings.NewReader("y\n")

	var out bytes.Buffer
	coursesDeleteCmd.SetOut(&out)
	if err := coursesDeleteCmd.RunE(coursesDeleteCmd, []string{"CS101"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !archived {
		t.Error("expected PATCH /archived to be called after confirming 'y'")
	}
}

func TestCoursesDelete_ConfirmNo(t *testing.T) {
	archived := false
	srv := newCoursesServer(t, coursesServerConfig{
		deleteHandler: func(w http.ResponseWriter, r *http.Request) {
			archived = true
			w.WriteHeader(http.StatusOK)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesDeleteInput = strings.NewReader("n\n")

	var out bytes.Buffer
	coursesDeleteCmd.SetOut(&out)
	if err := coursesDeleteCmd.RunE(coursesDeleteCmd, []string{"CS101"}); err != nil {
		t.Fatalf("RunE error with 'n' confirmation: %v", err)
	}

	if archived {
		t.Error("expected PATCH /archived not to be called after answering 'n'")
	}
	if !strings.Contains(out.String(), "Aborted") {
		t.Errorf("output = %q; want 'Aborted'", out.String())
	}
}

func TestCoursesDelete_ConfirmDefault(t *testing.T) {
	archived := false
	srv := newCoursesServer(t, coursesServerConfig{
		deleteHandler: func(w http.ResponseWriter, r *http.Request) {
			archived = true
			w.WriteHeader(http.StatusOK)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	// Empty input — default is N.
	coursesDeleteInput = strings.NewReader("\n")

	coursesDeleteCmd.SetOut(&bytes.Buffer{})
	if err := coursesDeleteCmd.RunE(coursesDeleteCmd, []string{"CS101"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if archived {
		t.Error("empty input (default N) should not call PATCH /archived")
	}
}

func TestCoursesDelete_NotFound(t *testing.T) {
	srv := newCoursesServer(t, coursesServerConfig{
		deleteHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Course not found."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesDeleteFlags.force = true

	err := coursesDeleteCmd.RunE(coursesDeleteCmd, []string{"MISSING"})
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

func TestCoursesDelete_JSONOutput(t *testing.T) {
	srv := newCoursesServer(t, coursesServerConfig{
		deleteHandler: func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"archived": true})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetCoursesFlags()
	coursesDeleteFlags.force = true
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	coursesDeleteCmd.SetOut(&out)
	if err := coursesDeleteCmd.RunE(coursesDeleteCmd, []string{"CS101"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["archived"] != "CS101" {
		t.Errorf("archived = %v, want CS101", result["archived"])
	}
}

// ============================================================
// courses command tree
// ============================================================

func TestCoursesCmd_HasSubcommands(t *testing.T) {
	names := map[string]bool{}
	for _, sub := range coursesCmd.Commands() {
		names[sub.Name()] = true
	}
	for _, want := range []string{"list", "get", "create", "delete"} {
		if !names[want] {
			t.Errorf("courses subcommand %q not registered", want)
		}
	}
}

func TestCoursesCmd_NeedsAuth(t *testing.T) {
	if !commandNeedsAuth(coursesCmd) {
		t.Error("coursesCmd should require auth")
	}
	for _, sub := range coursesCmd.Commands() {
		if !commandNeedsAuth(sub) {
			t.Errorf("courses %s should require auth", sub.Name())
		}
	}
}

func TestCoursesCreate_AuthorizationHeader(t *testing.T) {
	var gotAuth string
	srv := newCoursesServer(t, coursesServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(sampleCourse("CS001", "Test"))
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "my-secret-key")
	resetCoursesFlags()
	coursesCreateFlags.title = "Test"

	coursesCreateCmd.SetOut(&bytes.Buffer{})
	if err := coursesCreateCmd.RunE(coursesCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer my-secret-key" {
		t.Errorf("Authorization = %q, want 'Bearer my-secret-key'", gotAuth)
	}
}
