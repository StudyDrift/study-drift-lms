package cmd

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// gradesServerConfig holds optional handlers for the grades test server.
type gradesServerConfig struct {
	gridHandler   http.HandlerFunc // GET  .../gradebook/grid
	putHandler    http.HandlerFunc // PUT  .../gradebook/grades
}

func newGradesServer(t *testing.T, cfg gradesServerConfig) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/gradebook/grid"):
			if cfg.gridHandler != nil {
				cfg.gridHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/gradebook/grades"):
			if cfg.putHandler != nil {
				cfg.putHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
}

// sampleGrid returns a minimal gradebookGrid fixture with one student and two assignments.
func sampleGrid() gradebookGrid {
	maxPts := 100
	maxPts2 := 50
	return gradebookGrid{
		Students: []gradeStudent{
			{UserID: "user-001", DisplayName: "Alice Smith"},
			{UserID: "user-002", DisplayName: "Bob Jones"},
		},
		Columns: []gradeColumn{
			{ID: "item-aaa", Kind: "assignment", Title: "Homework 1", MaxPoints: &maxPts},
			{ID: "item-bbb", Kind: "assignment", Title: "Midterm", MaxPoints: &maxPts2},
		},
		Grades: map[string]map[string]string{
			"user-001": {"item-aaa": "90", "item-bbb": "45"},
			"user-002": {"item-aaa": "75"},
		},
	}
}

// resetGradesFlags resets all grades flag state between tests.
func resetGradesFlags() {
	gradesListFlags.course = ""
	gradesListFlags.user = ""
	gradesListFlags.limit = 50
	gradesListFlags.page = 1
	gradesUpdateFlags.course = ""
	gradesUpdateFlags.user = ""
	gradesUpdateFlags.item = ""
	gradesUpdateFlags.score = 0
	gradesUpdateFlags.comment = ""
	gradesExportFlags.course = ""
	gradesExportFlags.format = "csv"
	gradesExportFlags.output = ""
}

// ============================================================
// grades list
// ============================================================

func TestGradesList_Success(t *testing.T) {
	grid := sampleGrid()
	srv := newGradesServer(t, gradesServerConfig{
		gridHandler: func(w http.ResponseWriter, r *http.Request) {
			if !strings.Contains(r.URL.Path, "/CS101/") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(grid)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesListFlags.course = "CS101"

	var out bytes.Buffer
	gradesListCmd.SetOut(&out)
	if err := gradesListCmd.RunE(gradesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "Alice Smith") {
		t.Errorf("output missing Alice Smith: %q", output)
	}
	if !strings.Contains(output, "Homework 1") {
		t.Errorf("output missing Homework 1: %q", output)
	}
	if !strings.Contains(output, "90") {
		t.Errorf("output missing score 90: %q", output)
	}
}

func TestGradesList_JSONOutput(t *testing.T) {
	grid := sampleGrid()
	srv := newGradesServer(t, gradesServerConfig{
		gridHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(grid)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesListFlags.course = "CS101"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	gradesListCmd.SetOut(&out)
	if err := gradesListCmd.RunE(gradesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var rows []map[string]any
	if err := json.Unmarshal(out.Bytes(), &rows); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if len(rows) == 0 {
		t.Fatal("expected grade rows in JSON output")
	}
	if _, ok := rows[0]["student_id"]; !ok {
		t.Errorf("expected student_id field in rows: %v", rows[0])
	}
}

func TestGradesList_FilterByUser(t *testing.T) {
	grid := sampleGrid()
	srv := newGradesServer(t, gradesServerConfig{
		gridHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(grid)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesListFlags.course = "CS101"
	gradesListFlags.user = "user-001"

	var out bytes.Buffer
	gradesListCmd.SetOut(&out)
	if err := gradesListCmd.RunE(gradesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "Alice Smith") {
		t.Errorf("output missing Alice Smith: %q", output)
	}
	if strings.Contains(output, "Bob Jones") {
		t.Errorf("output should not contain Bob Jones (filtered out): %q", output)
	}
}

func TestGradesList_ServerError(t *testing.T) {
	srv := newGradesServer(t, gradesServerConfig{
		gridHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Course not found."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesListFlags.course = "MISSING"

	err := gradesListCmd.RunE(gradesListCmd, nil)
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

func TestGradesList_AuthorizationHeader(t *testing.T) {
	var gotAuth string
	srv := newGradesServer(t, gradesServerConfig{
		gridHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(gradebookGrid{})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "my-token")
	resetGradesFlags()
	gradesListFlags.course = "CS101"

	gradesListCmd.SetOut(&bytes.Buffer{})
	if err := gradesListCmd.RunE(gradesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer my-token" {
		t.Errorf("Authorization = %q, want 'Bearer my-token'", gotAuth)
	}
}

func TestGradesList_Pagination(t *testing.T) {
	grid := sampleGrid()
	srv := newGradesServer(t, gradesServerConfig{
		gridHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(grid)
		},
	})
	defer srv.Close()

	// With limit=1 page=1 we should get first row only.
	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesListFlags.course = "CS101"
	gradesListFlags.limit = 1
	gradesListFlags.page = 1
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	gradesListCmd.SetOut(&out)
	if err := gradesListCmd.RunE(gradesListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var rows []map[string]any
	if err := json.Unmarshal(out.Bytes(), &rows); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if len(rows) != 1 {
		t.Errorf("expected 1 row with limit=1 page=1, got %d", len(rows))
	}
}

// ============================================================
// grades update
// ============================================================

func TestGradesUpdate_Success(t *testing.T) {
	var gotBody map[string]any
	srv := newGradesServer(t, gradesServerConfig{
		putHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.WriteHeader(http.StatusNoContent)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesUpdateFlags.course = "CS101"
	gradesUpdateFlags.user = "user-001"
	gradesUpdateFlags.item = "item-aaa"
	gradesUpdateFlags.score = 95

	var out bytes.Buffer
	gradesUpdateCmd.SetOut(&out)
	if err := gradesUpdateCmd.RunE(gradesUpdateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "Grade updated") {
		t.Errorf("output = %q; want 'Grade updated'", output)
	}
	// Verify the request body contained the right structure.
	grades, _ := gotBody["grades"].(map[string]any)
	if grades == nil {
		t.Fatal("request body missing 'grades' key")
	}
	if grades["user-001"] == nil {
		t.Error("grades map missing user-001")
	}
}

func TestGradesUpdate_JSONOutput(t *testing.T) {
	srv := newGradesServer(t, gradesServerConfig{
		putHandler: func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesUpdateFlags.course = "CS101"
	gradesUpdateFlags.user = "user-001"
	gradesUpdateFlags.item = "item-aaa"
	gradesUpdateFlags.score = 88
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	gradesUpdateCmd.SetOut(&out)
	if err := gradesUpdateCmd.RunE(gradesUpdateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["user_id"] != "user-001" {
		t.Errorf("user_id = %v, want user-001", result["user_id"])
	}
	if result["score"].(float64) != 88 {
		t.Errorf("score = %v, want 88", result["score"])
	}
}

func TestGradesUpdate_PermissionDenied(t *testing.T) {
	srv := newGradesServer(t, gradesServerConfig{
		putHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Forbidden"})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesUpdateFlags.course = "CS101"
	gradesUpdateFlags.user = "user-001"
	gradesUpdateFlags.item = "item-aaa"
	gradesUpdateFlags.score = 90

	err := gradesUpdateCmd.RunE(gradesUpdateCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Errorf("err = %v, want permission denied message", err)
	}
}

func TestGradesUpdate_NegativeScore(t *testing.T) {
	setCfg("http://unused", "test-key")
	resetGradesFlags()
	gradesUpdateFlags.course = "CS101"
	gradesUpdateFlags.user = "user-001"
	gradesUpdateFlags.item = "item-aaa"
	gradesUpdateFlags.score = -1

	err := gradesUpdateCmd.RunE(gradesUpdateCmd, nil)
	if err == nil {
		t.Fatal("expected error for negative score, got nil")
	}
	if !strings.Contains(err.Error(), "score") {
		t.Errorf("err = %v, want score validation error", err)
	}
}

// ============================================================
// grades export
// ============================================================

func TestGradesExport_CSV(t *testing.T) {
	grid := sampleGrid()
	srv := newGradesServer(t, gradesServerConfig{
		gridHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(grid)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesExportFlags.course = "CS101"
	gradesExportFlags.format = "csv"

	var out bytes.Buffer
	gradesExportCmd.SetOut(&out)
	if err := gradesExportCmd.RunE(gradesExportCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	r := csv.NewReader(&out)
	records, err := r.ReadAll()
	if err != nil {
		t.Fatalf("output is not valid CSV: %v", err)
	}
	if len(records) < 2 {
		t.Fatalf("expected header + data rows, got %d records", len(records))
	}
	// Check header columns match FR-4.
	header := records[0]
	wantHeaders := []string{
		"student_id", "student_name", "student_email",
		"assignment_title", "score", "max_points", "percentage",
		"submitted_at", "graded_at", "comment",
	}
	for i, want := range wantHeaders {
		if i >= len(header) || header[i] != want {
			t.Errorf("header[%d] = %q, want %q", i, header[i], want)
		}
	}

	// Verify data rows contain expected values.
	foundAlice := false
	for _, rec := range records[1:] {
		if rec[0] == "user-001" && rec[3] == "Homework 1" {
			foundAlice = true
			if rec[4] != "90" {
				t.Errorf("Alice Homework 1 score = %q, want 90", rec[4])
			}
		}
	}
	if !foundAlice {
		t.Error("CSV missing row for user-001 / Homework 1")
	}
}

func TestGradesExport_JSONFormat(t *testing.T) {
	grid := sampleGrid()
	srv := newGradesServer(t, gradesServerConfig{
		gridHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(grid)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetGradesFlags()
	gradesExportFlags.course = "CS101"
	gradesExportFlags.format = "json"

	var out bytes.Buffer
	gradesExportCmd.SetOut(&out)
	if err := gradesExportCmd.RunE(gradesExportCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result gradebookGrid
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if len(result.Students) != 2 {
		t.Errorf("expected 2 students, got %d", len(result.Students))
	}
}

func TestGradesExport_InvalidFormat(t *testing.T) {
	setCfg("http://unused", "test-key")
	resetGradesFlags()
	gradesExportFlags.course = "CS101"
	gradesExportFlags.format = "xml"

	err := gradesExportCmd.RunE(gradesExportCmd, nil)
	if err == nil {
		t.Fatal("expected error for unsupported format, got nil")
	}
	if !strings.Contains(err.Error(), "unsupported format") {
		t.Errorf("err = %v, want unsupported format message", err)
	}
}
