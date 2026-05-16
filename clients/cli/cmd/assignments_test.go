package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// assignmentsServerConfig holds optional handlers for the assignment test server.
type assignmentsServerConfig struct {
	structureHandler http.HandlerFunc // GET  …/structure
	getHandler       http.HandlerFunc // GET  …/assignments/{id}
	createHandler    http.HandlerFunc // POST …/modules/{mid}/assignments
	patchHandler     http.HandlerFunc // PATCH …/assignments/{id}
	submitHandler    http.HandlerFunc // POST …/assignments/{id}/submissions
}

func newAssignmentsServer(t *testing.T, cfg assignmentsServerConfig) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(path, "/structure"):
			if cfg.structureHandler != nil {
				cfg.structureHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodGet && strings.Contains(path, "/assignments/"):
			if cfg.getHandler != nil {
				cfg.getHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/submissions"):
			if cfg.submitHandler != nil {
				cfg.submitHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPost && strings.Contains(path, "/assignments"):
			if cfg.createHandler != nil {
				cfg.createHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPatch && strings.Contains(path, "/assignments/"):
			if cfg.patchHandler != nil {
				cfg.patchHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
}

// sampleAssignmentItem returns a minimal structureItemPublic fixture of kind "assignment".
func sampleAssignmentItem(id, title string) structureItemPublic {
	pts := 100
	due := time.Date(2027, 9, 15, 23, 59, 0, 0, time.UTC)
	return structureItemPublic{
		ID:          id,
		SortOrder:   1,
		Kind:        "assignment",
		Title:       title,
		Published:   true,
		PointsWorth: &pts,
		DueAt:       &due,
		CreatedAt:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
	}
}

// sampleAssignment returns a minimal assignmentPublic fixture.
func sampleAssignment(id, title string) assignmentPublic {
	pts := 100
	due := time.Date(2027, 9, 15, 23, 59, 0, 0, time.UTC)
	tr := true
	return assignmentPublic{
		ItemID:                    id,
		Title:                     title,
		Markdown:                  "Do the work.",
		DueAt:                     &due,
		PointsWorth:               &pts,
		UpdatedAt:                 time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
		SubmissionAllowText:       &tr,
		SubmissionAllowFileUpload: &tr,
	}
}

// resetAssignmentsFlags resets all assignment flag state between tests.
func resetAssignmentsFlags() {
	assignmentsListFlags.course = ""
	assignmentsListFlags.limit = 50
	assignmentsListFlags.page = 1
	assignmentsGetFlags.course = ""
	assignmentsCreateFlags.course = ""
	assignmentsCreateFlags.module = ""
	assignmentsCreateFlags.title = ""
	assignmentsCreateFlags.points = -1
	assignmentsCreateFlags.due = ""
	assignmentsSubmitFlags.course = ""
	assignmentsSubmitFlags.assignment = ""
	assignmentsSubmitFlags.file = ""
	assignmentsSubmitFlags.quiet = false
	assignmentsProgressOut = nil
}

// ============================================================
// assignments list
// ============================================================

func TestAssignmentsList_Success(t *testing.T) {
	items := []structureItemPublic{
		sampleAssignmentItem("aaa-111", "Homework 1"),
		{ID: "mod-001", Kind: "module", Title: "Week 1", CreatedAt: time.Now(), UpdatedAt: time.Now()}, // should be filtered out
		sampleAssignmentItem("aaa-222", "Homework 2"),
	}
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		structureHandler: func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasSuffix(r.URL.Path, "/CS101/structure") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(courseStructureBody{Items: items})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsListFlags.course = "CS101"

	var out bytes.Buffer
	assignmentsListCmd.SetOut(&out)
	if err := assignmentsListCmd.RunE(assignmentsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "Homework 1") {
		t.Errorf("output = %q; want Homework 1", output)
	}
	if !strings.Contains(output, "Homework 2") {
		t.Errorf("output = %q; want Homework 2", output)
	}
	if strings.Contains(output, "Week 1") {
		t.Errorf("output should not include module items; output = %q", output)
	}
}

func TestAssignmentsList_JSONOutput(t *testing.T) {
	items := []structureItemPublic{sampleAssignmentItem("aaa-111", "Homework 1")}
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		structureHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(courseStructureBody{Items: items})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsListFlags.course = "CS101"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	assignmentsListCmd.SetOut(&out)
	if err := assignmentsListCmd.RunE(assignmentsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result []map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 assignment, got %d", len(result))
	}
	if result[0]["id"] != "aaa-111" {
		t.Errorf("id = %v, want aaa-111", result[0]["id"])
	}
}

func TestAssignmentsList_FiltersNonAssignments(t *testing.T) {
	items := []structureItemPublic{
		{ID: "m1", Kind: "module", Title: "Module", CreatedAt: time.Now(), UpdatedAt: time.Now()},
		{ID: "p1", Kind: "content_page", Title: "Page", CreatedAt: time.Now(), UpdatedAt: time.Now()},
	}
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		structureHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(courseStructureBody{Items: items})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsListFlags.course = "CS101"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	assignmentsListCmd.SetOut(&out)
	if err := assignmentsListCmd.RunE(assignmentsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result []any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if len(result) != 0 {
		t.Errorf("expected 0 assignments after filtering, got %d", len(result))
	}
}

func TestAssignmentsList_Pagination(t *testing.T) {
	items := make([]structureItemPublic, 5)
	for i := range items {
		items[i] = sampleAssignmentItem(fmt.Sprintf("id-%d", i), fmt.Sprintf("HW%d", i+1))
	}
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		structureHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(courseStructureBody{Items: items})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsListFlags.course = "CS101"
	assignmentsListFlags.limit = 2
	assignmentsListFlags.page = 2 // items [2, 3] → HW3, HW4

	var out bytes.Buffer
	assignmentsListCmd.SetOut(&out)
	if err := assignmentsListCmd.RunE(assignmentsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	output := out.String()
	if strings.Contains(output, "HW1") || strings.Contains(output, "HW2") {
		t.Errorf("page 2 should not contain page-1 items; output = %q", output)
	}
	if !strings.Contains(output, "HW3") {
		t.Errorf("page 2 should contain HW3; output = %q", output)
	}
}

func TestAssignmentsList_ServerError(t *testing.T) {
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		structureHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Course not found."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsListFlags.course = "MISSING"

	err := assignmentsListCmd.RunE(assignmentsListCmd, nil)
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

func TestAssignmentsList_AuthorizationHeader(t *testing.T) {
	var gotAuth string
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		structureHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(courseStructureBody{Items: nil})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "my-token")
	resetAssignmentsFlags()
	assignmentsListFlags.course = "CS101"

	assignmentsListCmd.SetOut(&bytes.Buffer{})
	if err := assignmentsListCmd.RunE(assignmentsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer my-token" {
		t.Errorf("Authorization = %q, want 'Bearer my-token'", gotAuth)
	}
}

// ============================================================
// assignments get
// ============================================================

func TestAssignmentsGet_Success(t *testing.T) {
	a := sampleAssignment("item-001", "Homework 1")
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasSuffix(r.URL.Path, "/item-001") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(a)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsGetFlags.course = "CS101"

	var out bytes.Buffer
	assignmentsGetCmd.SetOut(&out)
	if err := assignmentsGetCmd.RunE(assignmentsGetCmd, []string{"item-001"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "Homework 1") {
		t.Errorf("output = %q; want assignment title", output)
	}
	if !strings.Contains(output, "item-001") {
		t.Errorf("output = %q; want item ID", output)
	}
	if !strings.Contains(output, "100") {
		t.Errorf("output = %q; want points", output)
	}
}

func TestAssignmentsGet_JSONOutput(t *testing.T) {
	a := sampleAssignment("item-001", "Homework 1")
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(a)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsGetFlags.course = "CS101"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	assignmentsGetCmd.SetOut(&out)
	if err := assignmentsGetCmd.RunE(assignmentsGetCmd, []string{"item-001"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["itemId"] != "item-001" {
		t.Errorf("itemId = %v, want item-001", result["itemId"])
	}
	if result["title"] != "Homework 1" {
		t.Errorf("title = %v, want Homework 1", result["title"])
	}
}

func TestAssignmentsGet_NotFound(t *testing.T) {
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Not found."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsGetFlags.course = "CS101"

	err := assignmentsGetCmd.RunE(assignmentsGetCmd, []string{"missing-id"})
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

func TestAssignmentsGet_NilOptionalFields(t *testing.T) {
	a := assignmentPublic{
		ItemID:    "item-001",
		Title:     "No Due Date",
		UpdatedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
	}
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		getHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(a)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsGetFlags.course = "CS101"

	var out bytes.Buffer
	assignmentsGetCmd.SetOut(&out)
	if err := assignmentsGetCmd.RunE(assignmentsGetCmd, []string{"item-001"}); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	// Should not crash on nil optional fields.
	if !strings.Contains(out.String(), "No Due Date") {
		t.Errorf("output = %q; want title", out.String())
	}
}

// ============================================================
// assignments create
// ============================================================

func TestAssignmentsCreate_TitleOnly(t *testing.T) {
	created := sampleAssignmentItem("new-item-001", "HW1")
	var gotBody map[string]any
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsCreateFlags.course = "CS101"
	assignmentsCreateFlags.module = "mod-uuid-1"
	assignmentsCreateFlags.title = "HW1"

	var out bytes.Buffer
	assignmentsCreateCmd.SetOut(&out)
	if err := assignmentsCreateCmd.RunE(assignmentsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if gotBody["title"] != "HW1" {
		t.Errorf("title sent = %v, want HW1", gotBody["title"])
	}
	if !strings.Contains(out.String(), "new-item-001") {
		t.Errorf("output = %q; want item ID", out.String())
	}
}

func TestAssignmentsCreate_WithPointsAndDue(t *testing.T) {
	created := sampleAssignmentItem("new-item-002", "HW2")
	var patchCalled bool
	var gotPatch map[string]any
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
		patchHandler: func(w http.ResponseWriter, r *http.Request) {
			patchCalled = true
			_ = json.NewDecoder(r.Body).Decode(&gotPatch)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(sampleAssignment("new-item-002", "HW2"))
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsCreateFlags.course = "CS101"
	assignmentsCreateFlags.module = "mod-uuid-1"
	assignmentsCreateFlags.title = "HW2"
	assignmentsCreateFlags.points = 50
	assignmentsCreateFlags.due = "2027-09-15"

	assignmentsCreateCmd.SetOut(&bytes.Buffer{})
	if err := assignmentsCreateCmd.RunE(assignmentsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !patchCalled {
		t.Fatal("expected PATCH to be called for points/due, but it was not")
	}
	if gotPatch["pointsWorth"] != float64(50) {
		t.Errorf("pointsWorth = %v, want 50", gotPatch["pointsWorth"])
	}
	if _, ok := gotPatch["dueAt"]; !ok {
		t.Error("expected dueAt in patch body, not found")
	}
}

func TestAssignmentsCreate_NoPatchWhenNoOptionals(t *testing.T) {
	created := sampleAssignmentItem("item-x", "Solo")
	patchCalled := false
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
		patchHandler: func(w http.ResponseWriter, r *http.Request) {
			patchCalled = true
			w.WriteHeader(http.StatusOK)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsCreateFlags.course = "CS101"
	assignmentsCreateFlags.module = "mod-1"
	assignmentsCreateFlags.title = "Solo"
	// points = -1 (default), due = "" → no PATCH

	assignmentsCreateCmd.SetOut(&bytes.Buffer{})
	if err := assignmentsCreateCmd.RunE(assignmentsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if patchCalled {
		t.Error("PATCH should not be called when no optional fields are set")
	}
}

func TestAssignmentsCreate_JSONOutput(t *testing.T) {
	created := sampleAssignmentItem("json-id-1", "JSON Assignment")
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsCreateFlags.course = "CS101"
	assignmentsCreateFlags.module = "mod-1"
	assignmentsCreateFlags.title = "JSON Assignment"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	assignmentsCreateCmd.SetOut(&out)
	if err := assignmentsCreateCmd.RunE(assignmentsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["id"] != "json-id-1" {
		t.Errorf("id = %v, want json-id-1", result["id"])
	}
}

func TestAssignmentsCreate_ServerError(t *testing.T) {
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "You do not have permission."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsCreateFlags.course = "CS101"
	assignmentsCreateFlags.module = "mod-1"
	assignmentsCreateFlags.title = "Bad"

	err := assignmentsCreateCmd.RunE(assignmentsCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "permission") {
		t.Errorf("err = %v, want permission error", err)
	}
}

func TestAssignmentsCreate_InvalidDueDate(t *testing.T) {
	created := sampleAssignmentItem("item-x", "Bad Due")
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsCreateFlags.course = "CS101"
	assignmentsCreateFlags.module = "mod-1"
	assignmentsCreateFlags.title = "Bad Due"
	assignmentsCreateFlags.due = "not-a-date"

	err := assignmentsCreateCmd.RunE(assignmentsCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for invalid due date, got nil")
	}
	if !strings.Contains(err.Error(), "invalid due date") {
		t.Errorf("err = %v, want invalid due date error", err)
	}
}

func TestAssignmentsCreate_URLContainsModuleAndCourse(t *testing.T) {
	var gotPath string
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(sampleAssignmentItem("id", "T"))
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsCreateFlags.course = "CS101"
	assignmentsCreateFlags.module = "mod-uuid-999"
	assignmentsCreateFlags.title = "T"

	assignmentsCreateCmd.SetOut(&bytes.Buffer{})
	if err := assignmentsCreateCmd.RunE(assignmentsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if !strings.Contains(gotPath, "CS101") {
		t.Errorf("path = %q; want CS101", gotPath)
	}
	if !strings.Contains(gotPath, "mod-uuid-999") {
		t.Errorf("path = %q; want mod-uuid-999", gotPath)
	}
}

// ============================================================
// assignments submit
// ============================================================

func TestAssignmentsSubmit_FileNotFound(t *testing.T) {
	// No server needed; the CLI exits before making any API call.
	setCfg("http://localhost:0", "test-key")
	resetAssignmentsFlags()
	assignmentsSubmitFlags.course = "CS101"
	assignmentsSubmitFlags.assignment = "item-001"
	assignmentsSubmitFlags.file = "/nonexistent/path/submission.zip"

	err := assignmentsSubmitCmd.RunE(assignmentsSubmitCmd, nil)
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
	if !strings.Contains(err.Error(), "File not found") {
		t.Errorf("err = %q; want 'File not found'", err.Error())
	}
	if !strings.Contains(err.Error(), "/nonexistent/path/submission.zip") {
		t.Errorf("err = %q; want the file path in error message", err.Error())
	}
}

func TestAssignmentsSubmit_Success(t *testing.T) {
	// Create a small temp file to submit.
	f, err := os.CreateTemp(t.TempDir(), "submit-*.txt")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	_, _ = f.WriteString("my submission content")
	_ = f.Close()

	receipt := submissionReceipt{
		SubmissionID: "sub-123",
		SubmittedAt:  time.Date(2027, 9, 15, 10, 0, 0, 0, time.UTC),
	}

	var gotContentType string
	var gotFileName string
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		submitHandler: func(w http.ResponseWriter, r *http.Request) {
			gotContentType = r.Header.Get("Content-Type")
			_ = r.ParseMultipartForm(32 << 20)
			if r.MultipartForm != nil {
				if files := r.MultipartForm.File["file"]; len(files) > 0 {
					gotFileName = files[0].Filename
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(receipt)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsSubmitFlags.course = "CS101"
	assignmentsSubmitFlags.assignment = "item-001"
	assignmentsSubmitFlags.file = f.Name()
	assignmentsSubmitFlags.quiet = true

	var out bytes.Buffer
	assignmentsSubmitCmd.SetOut(&out)
	if err := assignmentsSubmitCmd.RunE(assignmentsSubmitCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "sub-123") {
		t.Errorf("output = %q; want submission ID", output)
	}
	if !strings.Contains(output, "2027-09-15") {
		t.Errorf("output = %q; want submitted-at timestamp", output)
	}
	if !strings.Contains(gotContentType, "multipart/form-data") {
		t.Errorf("content-type = %q; want multipart/form-data", gotContentType)
	}
	if gotFileName != filepath.Base(f.Name()) {
		t.Errorf("filename = %q; want %q", gotFileName, filepath.Base(f.Name()))
	}
}

func TestAssignmentsSubmit_JSONOutput(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "submit-*.txt")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	_, _ = f.WriteString("content")
	_ = f.Close()

	receipt := submissionReceipt{
		SubmissionID: "sub-456",
		SubmittedAt:  time.Date(2027, 9, 15, 10, 0, 0, 0, time.UTC),
	}
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		submitHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(receipt)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsSubmitFlags.course = "CS101"
	assignmentsSubmitFlags.assignment = "item-001"
	assignmentsSubmitFlags.file = f.Name()
	assignmentsSubmitFlags.quiet = true
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	assignmentsSubmitCmd.SetOut(&out)
	if err := assignmentsSubmitCmd.RunE(assignmentsSubmitCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	// The raw JSON receipt is passed through as-is.
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["submission_id"] != "sub-456" {
		t.Errorf("submission_id = %v, want sub-456", result["submission_id"])
	}
}

func TestAssignmentsSubmit_ServerError(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "submit-*.txt")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	_, _ = f.WriteString("content")
	_ = f.Close()

	srv := newAssignmentsServer(t, assignmentsServerConfig{
		submitHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Submissions not allowed."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsSubmitFlags.course = "CS101"
	assignmentsSubmitFlags.assignment = "item-001"
	assignmentsSubmitFlags.file = f.Name()
	assignmentsSubmitFlags.quiet = true

	err = assignmentsSubmitCmd.RunE(assignmentsSubmitCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "Submissions not allowed") {
		t.Errorf("err = %v, want Submissions not allowed", err)
	}
}

func TestAssignmentsSubmit_QuietSuppressesProgress(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "submit-*.txt")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	_, _ = f.WriteString("some content")
	_ = f.Close()

	receipt := submissionReceipt{SubmissionID: "s-1", SubmittedAt: time.Now()}
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		submitHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(receipt)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetAssignmentsFlags()
	assignmentsSubmitFlags.course = "CS101"
	assignmentsSubmitFlags.assignment = "item-001"
	assignmentsSubmitFlags.file = f.Name()
	assignmentsSubmitFlags.quiet = true

	var progressBuf bytes.Buffer
	assignmentsProgressOut = &progressBuf

	assignmentsSubmitCmd.SetOut(&bytes.Buffer{})
	if err := assignmentsSubmitCmd.RunE(assignmentsSubmitCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if strings.Contains(progressBuf.String(), "Submitting") {
		t.Errorf("quiet mode should suppress 'Submitting' message; got: %q", progressBuf.String())
	}
}

func TestAssignmentsSubmit_AuthorizationHeader(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "submit-*.txt")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	_, _ = f.WriteString("data")
	_ = f.Close()

	var gotAuth string
	receipt := submissionReceipt{SubmissionID: "s-2", SubmittedAt: time.Now()}
	srv := newAssignmentsServer(t, assignmentsServerConfig{
		submitHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(receipt)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "my-submit-key")
	resetAssignmentsFlags()
	assignmentsSubmitFlags.course = "CS101"
	assignmentsSubmitFlags.assignment = "item-001"
	assignmentsSubmitFlags.file = f.Name()
	assignmentsSubmitFlags.quiet = true

	assignmentsSubmitCmd.SetOut(&bytes.Buffer{})
	if err := assignmentsSubmitCmd.RunE(assignmentsSubmitCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer my-submit-key" {
		t.Errorf("Authorization = %q, want 'Bearer my-submit-key'", gotAuth)
	}
}

// ============================================================
// parseAssignmentDue
// ============================================================

func TestParseAssignmentDue_RFC3339(t *testing.T) {
	s := "2027-09-15T23:59:00Z"
	got, err := parseAssignmentDue(s)
	if err != nil {
		t.Fatalf("parseAssignmentDue(%q): %v", s, err)
	}
	if got.Year() != 2027 || got.Month() != 9 || got.Day() != 15 {
		t.Errorf("got %v, want 2027-09-15", got)
	}
}

func TestParseAssignmentDue_DateOnly(t *testing.T) {
	s := "2027-09-15"
	got, err := parseAssignmentDue(s)
	if err != nil {
		t.Fatalf("parseAssignmentDue(%q): %v", s, err)
	}
	if got.Hour() != 23 || got.Minute() != 59 {
		t.Errorf("date-only should default to 23:59; got %v", got)
	}
}

func TestParseAssignmentDue_Invalid(t *testing.T) {
	_, err := parseAssignmentDue("not-a-date")
	if err == nil {
		t.Fatal("expected error for invalid date, got nil")
	}
	if !strings.Contains(err.Error(), "invalid due date") {
		t.Errorf("err = %v, want 'invalid due date'", err)
	}
}

// ============================================================
// assignments command tree
// ============================================================

func TestAssignmentsCmd_HasSubcommands(t *testing.T) {
	names := map[string]bool{}
	for _, sub := range assignmentsCmd.Commands() {
		names[sub.Name()] = true
	}
	for _, want := range []string{"list", "get", "create", "submit"} {
		if !names[want] {
			t.Errorf("assignments subcommand %q not registered", want)
		}
	}
}

func TestAssignmentsCmd_NeedsAuth(t *testing.T) {
	if !commandNeedsAuth(assignmentsCmd) {
		t.Error("assignmentsCmd should require auth")
	}
	for _, sub := range assignmentsCmd.Commands() {
		if !commandNeedsAuth(sub) {
			t.Errorf("assignments %s should require auth", sub.Name())
		}
	}
}
