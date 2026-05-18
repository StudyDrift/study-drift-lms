package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// questionsServerConfig holds optional handlers for the questions test server.
type questionsServerConfig struct {
	listHandler   http.HandlerFunc // GET  .../questions
	createHandler http.HandlerFunc // POST .../questions
	importHandler http.HandlerFunc // POST .../import
}

func newQuestionsServer(t *testing.T, cfg questionsServerConfig) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(path, "/questions"):
			if cfg.listHandler != nil {
				cfg.listHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/questions"):
			if cfg.createHandler != nil {
				cfg.createHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		case r.Method == http.MethodPost && strings.HasSuffix(path, "/import"):
			if cfg.importHandler != nil {
				cfg.importHandler(w, r)
			} else {
				http.NotFound(w, r)
			}
		default:
			http.NotFound(w, r)
		}
	}))
}

// sampleQuestion returns a minimal questionPublic fixture.
func sampleQuestion(id, qtype, text string) questionPublic {
	return questionPublic{
		ID:     id,
		BankID: "bank-001",
		Type:   qtype,
		Content: map[string]any{
			"text": text,
		},
	}
}

// resetQuestionsFlags resets all question flag state between tests.
func resetQuestionsFlags() {
	questionsListFlags.bank = ""
	questionsListFlags.qtype = ""
	questionsListFlags.limit = 50
	questionsListFlags.page = 1
	questionsCreateFlags.bank = ""
	questionsCreateFlags.qtype = ""
	questionsCreateFlags.content = ""
	questionsImportFlags.bank = ""
	questionsImportFlags.file = ""
	questionsImportFlags.quiet = false
	questionsProgressOut = nil
}

// ============================================================
// questions list
// ============================================================

func TestQuestionsList_Success(t *testing.T) {
	questions := []questionPublic{
		sampleQuestion("q-001", "multiple-choice", "What is 2+2?"),
		sampleQuestion("q-002", "true-false", "The sky is blue."),
	}
	srv := newQuestionsServer(t, questionsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			if !strings.Contains(r.URL.Path, "/bank-001/questions") {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(questions)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsListFlags.bank = "bank-001"

	var out bytes.Buffer
	questionsListCmd.SetOut(&out)
	if err := questionsListCmd.RunE(questionsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "q-001") {
		t.Errorf("output = %q; want q-001", output)
	}
	if !strings.Contains(output, "multiple-choice") {
		t.Errorf("output = %q; want multiple-choice", output)
	}
	if !strings.Contains(output, "What is 2+2?") {
		t.Errorf("output = %q; want question preview", output)
	}
}

func TestQuestionsList_JSONOutput(t *testing.T) {
	questions := []questionPublic{sampleQuestion("q-001", "essay", "Explain the water cycle.")}
	srv := newQuestionsServer(t, questionsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(questions)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsListFlags.bank = "bank-001"
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	questionsListCmd.SetOut(&out)
	if err := questionsListCmd.RunE(questionsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result []map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if len(result) != 1 {
		t.Fatalf("expected 1 question, got %d", len(result))
	}
	if result[0]["id"] != "q-001" {
		t.Errorf("id = %v, want q-001", result[0]["id"])
	}
}

func TestQuestionsList_TypeFilterSentToServer(t *testing.T) {
	var gotType string
	srv := newQuestionsServer(t, questionsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			gotType = r.URL.Query().Get("type")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]questionPublic{})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsListFlags.bank = "bank-001"
	questionsListFlags.qtype = "multiple-choice"

	questionsListCmd.SetOut(&bytes.Buffer{})
	if err := questionsListCmd.RunE(questionsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotType != "multiple-choice" {
		t.Errorf("type query param = %q, want multiple-choice", gotType)
	}
}

func TestQuestionsList_ServerError(t *testing.T) {
	srv := newQuestionsServer(t, questionsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Bank not found."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsListFlags.bank = "missing-bank"

	err := questionsListCmd.RunE(questionsListCmd, nil)
	if err == nil {
		t.Fatal("expected error for 404, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("err = %v, want 404", err)
	}
}

func TestQuestionsList_AuthorizationHeader(t *testing.T) {
	var gotAuth string
	srv := newQuestionsServer(t, questionsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]questionPublic{})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "my-token")
	resetQuestionsFlags()
	questionsListFlags.bank = "bank-001"

	questionsListCmd.SetOut(&bytes.Buffer{})
	if err := questionsListCmd.RunE(questionsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if gotAuth != "Bearer my-token" {
		t.Errorf("Authorization = %q, want 'Bearer my-token'", gotAuth)
	}
}

func TestQuestionsList_LongPreviewTruncated(t *testing.T) {
	longText := strings.Repeat("x", 80)
	questions := []questionPublic{sampleQuestion("q-001", "essay", longText)}
	srv := newQuestionsServer(t, questionsServerConfig{
		listHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(questions)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsListFlags.bank = "bank-001"

	var out bytes.Buffer
	questionsListCmd.SetOut(&out)
	if err := questionsListCmd.RunE(questionsListCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if !strings.Contains(out.String(), "...") {
		t.Errorf("output = %q; want truncated preview with ...", out.String())
	}
}

// ============================================================
// questions create
// ============================================================

func TestQuestionsCreate_Success(t *testing.T) {
	created := sampleQuestion("new-q-001", "multiple-choice", "What color is the sky?")
	var gotBody map[string]any
	srv := newQuestionsServer(t, questionsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsCreateFlags.bank = "bank-001"
	questionsCreateFlags.qtype = "multiple-choice"
	questionsCreateFlags.content = `{"text":"What color is the sky?","choices":["blue","red"]}`

	var out bytes.Buffer
	questionsCreateCmd.SetOut(&out)
	if err := questionsCreateCmd.RunE(questionsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if gotBody["type"] != "multiple-choice" {
		t.Errorf("type sent = %v, want multiple-choice", gotBody["type"])
	}
	if !strings.Contains(out.String(), "new-q-001") {
		t.Errorf("output = %q; want question ID", out.String())
	}
}

func TestQuestionsCreate_AtFileContent(t *testing.T) {
	contentJSON := `{"text":"From file question","answer":true}`
	f, err := os.CreateTemp(t.TempDir(), "question-*.json")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	_, _ = f.WriteString(contentJSON)
	_ = f.Close()

	created := sampleQuestion("new-q-002", "true-false", "From file question")
	var gotBody map[string]any
	srv := newQuestionsServer(t, questionsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewDecoder(r.Body).Decode(&gotBody)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsCreateFlags.bank = "bank-001"
	questionsCreateFlags.qtype = "true-false"
	questionsCreateFlags.content = "@" + f.Name()

	var out bytes.Buffer
	questionsCreateCmd.SetOut(&out)
	if err := questionsCreateCmd.RunE(questionsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	content, ok := gotBody["content"].(map[string]any)
	if !ok {
		t.Fatalf("content field missing or wrong type")
	}
	if content["text"] != "From file question" {
		t.Errorf("content.text = %v, want 'From file question'", content["text"])
	}
	if !strings.Contains(out.String(), "new-q-002") {
		t.Errorf("output = %q; want question ID", out.String())
	}
}

func TestQuestionsCreate_InvalidType(t *testing.T) {
	setCfg("http://localhost:0", "test-key")
	resetQuestionsFlags()
	questionsCreateFlags.bank = "bank-001"
	questionsCreateFlags.qtype = "invalid-type"
	questionsCreateFlags.content = `{"text":"test"}`

	err := questionsCreateCmd.RunE(questionsCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for invalid type, got nil")
	}
	if !strings.Contains(err.Error(), "invalid question type") {
		t.Errorf("err = %v, want invalid question type error", err)
	}
}

func TestQuestionsCreate_InvalidContentJSON(t *testing.T) {
	setCfg("http://localhost:0", "test-key")
	resetQuestionsFlags()
	questionsCreateFlags.bank = "bank-001"
	questionsCreateFlags.qtype = "essay"
	questionsCreateFlags.content = `not-valid-json`

	err := questionsCreateCmd.RunE(questionsCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for invalid JSON content, got nil")
	}
	if !strings.Contains(err.Error(), "parsing content JSON") {
		t.Errorf("err = %v, want parsing content JSON error", err)
	}
}

func TestQuestionsCreate_AtFileMissing(t *testing.T) {
	setCfg("http://localhost:0", "test-key")
	resetQuestionsFlags()
	questionsCreateFlags.bank = "bank-001"
	questionsCreateFlags.qtype = "essay"
	questionsCreateFlags.content = "@/nonexistent/question.json"

	err := questionsCreateCmd.RunE(questionsCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for missing @file, got nil")
	}
	if !strings.Contains(err.Error(), "reading content file") {
		t.Errorf("err = %v, want reading content file error", err)
	}
}

func TestQuestionsCreate_JSONOutput(t *testing.T) {
	created := sampleQuestion("json-q-1", "short-answer", "Describe photosynthesis.")
	srv := newQuestionsServer(t, questionsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsCreateFlags.bank = "bank-001"
	questionsCreateFlags.qtype = "short-answer"
	questionsCreateFlags.content = `{"text":"Describe photosynthesis."}`
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	questionsCreateCmd.SetOut(&out)
	if err := questionsCreateCmd.RunE(questionsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["id"] != "json-q-1" {
		t.Errorf("id = %v, want json-q-1", result["id"])
	}
	if result["type"] != "short-answer" {
		t.Errorf("type = %v, want short-answer", result["type"])
	}
}

func TestQuestionsCreate_ServerError(t *testing.T) {
	srv := newQuestionsServer(t, questionsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "You do not have permission."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsCreateFlags.bank = "bank-001"
	questionsCreateFlags.qtype = "essay"
	questionsCreateFlags.content = `{"text":"test"}`

	err := questionsCreateCmd.RunE(questionsCreateCmd, nil)
	if err == nil {
		t.Fatal("expected error for 403, got nil")
	}
	if !strings.Contains(err.Error(), "permission") {
		t.Errorf("err = %v, want permission error", err)
	}
}

func TestQuestionsCreate_URLContainsBankID(t *testing.T) {
	var gotPath string
	created := sampleQuestion("q-x", "essay", "test")
	srv := newQuestionsServer(t, questionsServerConfig{
		createHandler: func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(created)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsCreateFlags.bank = "my-bank-123"
	questionsCreateFlags.qtype = "essay"
	questionsCreateFlags.content = `{"text":"test"}`

	questionsCreateCmd.SetOut(&bytes.Buffer{})
	if err := questionsCreateCmd.RunE(questionsCreateCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}
	if !strings.Contains(gotPath, "my-bank-123") {
		t.Errorf("path = %q; want my-bank-123", gotPath)
	}
}

// ============================================================
// questions import
// ============================================================

func newTempZipFile(t *testing.T) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "qti-*.zip")
	if err != nil {
		t.Fatalf("creating temp zip: %v", err)
	}
	_, _ = f.WriteString("PK\x03\x04") // minimal zip magic bytes
	_ = f.Close()
	return f.Name()
}

func TestQuestionsImport_FileNotFound(t *testing.T) {
	setCfg("http://localhost:0", "test-key")
	resetQuestionsFlags()
	questionsImportFlags.bank = "bank-001"
	questionsImportFlags.file = "/nonexistent/qti.zip"

	err := questionsImportCmd.RunE(questionsImportCmd, nil)
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
	if !strings.Contains(err.Error(), "file not found") {
		t.Errorf("err = %q; want 'file not found'", err.Error())
	}
}

func TestQuestionsImport_NotAZip(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "qti-*.xml")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	_, _ = f.WriteString("<xml/>")
	_ = f.Close()

	setCfg("http://localhost:0", "test-key")
	resetQuestionsFlags()
	questionsImportFlags.bank = "bank-001"
	questionsImportFlags.file = f.Name()

	err = questionsImportCmd.RunE(questionsImportCmd, nil)
	if err == nil {
		t.Fatal("expected error for non-zip file, got nil")
	}
	if !strings.Contains(err.Error(), ".zip") {
		t.Errorf("err = %v, want .zip error", err)
	}
}

func TestQuestionsImport_Success(t *testing.T) {
	zipPath := newTempZipFile(t)

	summary := importSummary{Total: 50, Created: 47, Skipped: 3, Failed: 0}
	var gotContentType string
	var gotFileName string
	srv := newQuestionsServer(t, questionsServerConfig{
		importHandler: func(w http.ResponseWriter, r *http.Request) {
			gotContentType = r.Header.Get("Content-Type")
			_ = r.ParseMultipartForm(32 << 20)
			if r.MultipartForm != nil {
				if files := r.MultipartForm.File["file"]; len(files) > 0 {
					gotFileName = files[0].Filename
				}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(summary)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsImportFlags.bank = "bank-001"
	questionsImportFlags.file = zipPath
	questionsImportFlags.quiet = true

	var out bytes.Buffer
	questionsImportCmd.SetOut(&out)
	if err := questionsImportCmd.RunE(questionsImportCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	output := out.String()
	if !strings.Contains(output, "47/50") {
		t.Errorf("output = %q; want 47/50", output)
	}
	if !strings.Contains(output, "3 skipped") {
		t.Errorf("output = %q; want 3 skipped", output)
	}
	if !strings.Contains(gotContentType, "multipart/form-data") {
		t.Errorf("content-type = %q; want multipart/form-data", gotContentType)
	}
	if gotFileName != filepath.Base(zipPath) {
		t.Errorf("filename = %q; want %q", gotFileName, filepath.Base(zipPath))
	}
}

func TestQuestionsImport_JSONOutput(t *testing.T) {
	zipPath := newTempZipFile(t)

	summary := importSummary{Total: 10, Created: 8, Skipped: 1, Failed: 1, Errors: []string{"question 7 parse error"}}
	srv := newQuestionsServer(t, questionsServerConfig{
		importHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(summary)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsImportFlags.bank = "bank-001"
	questionsImportFlags.file = zipPath
	questionsImportFlags.quiet = true
	globalFlags.jsonOut = true
	defer func() { globalFlags.jsonOut = false }()

	var out bytes.Buffer
	questionsImportCmd.SetOut(&out)
	if err := questionsImportCmd.RunE(questionsImportCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("not valid JSON: %v — output: %s", err, out.String())
	}
	if result["created"] != float64(8) {
		t.Errorf("created = %v, want 8", result["created"])
	}
}

func TestQuestionsImport_WithErrors_PrintsPerError(t *testing.T) {
	zipPath := newTempZipFile(t)

	summary := importSummary{
		Total:   5,
		Created: 3,
		Skipped: 0,
		Failed:  2,
		Errors:  []string{"question 2: unsupported type", "question 4: missing stem"},
	}
	srv := newQuestionsServer(t, questionsServerConfig{
		importHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(summary)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsImportFlags.bank = "bank-001"
	questionsImportFlags.file = zipPath
	questionsImportFlags.quiet = true

	var progressBuf bytes.Buffer
	questionsProgressOut = &progressBuf

	var out bytes.Buffer
	questionsImportCmd.SetOut(&out)
	if err := questionsImportCmd.RunE(questionsImportCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	prog := progressBuf.String()
	if !strings.Contains(prog, "unsupported type") {
		t.Errorf("progress = %q; want per-error output", prog)
	}
	if !strings.Contains(prog, "missing stem") {
		t.Errorf("progress = %q; want second error", prog)
	}
	if !strings.Contains(out.String(), "2 failed") {
		t.Errorf("output = %q; want 2 failed in summary", out.String())
	}
}

func TestQuestionsImport_AllFailed_ReturnsError(t *testing.T) {
	zipPath := newTempZipFile(t)

	summary := importSummary{Total: 3, Created: 0, Skipped: 0, Failed: 3,
		Errors: []string{"q1 error", "q2 error", "q3 error"}}
	srv := newQuestionsServer(t, questionsServerConfig{
		importHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(summary)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsImportFlags.bank = "bank-001"
	questionsImportFlags.file = zipPath
	questionsImportFlags.quiet = true

	var progressBuf bytes.Buffer
	questionsProgressOut = &progressBuf

	err := questionsImportCmd.RunE(questionsImportCmd, nil)
	if err == nil {
		t.Fatal("expected error when all questions fail, got nil")
	}
	if !strings.Contains(err.Error(), "all") || !strings.Contains(err.Error(), "failed") {
		t.Errorf("err = %v, want all failed error", err)
	}
}

func TestQuestionsImport_ServerError(t *testing.T) {
	zipPath := newTempZipFile(t)

	srv := newQuestionsServer(t, questionsServerConfig{
		importHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "Invalid QTI format."})
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsImportFlags.bank = "bank-001"
	questionsImportFlags.file = zipPath
	questionsImportFlags.quiet = true

	err := questionsImportCmd.RunE(questionsImportCmd, nil)
	if err == nil {
		t.Fatal("expected error for 422, got nil")
	}
	if !strings.Contains(err.Error(), "Invalid QTI format") {
		t.Errorf("err = %v, want Invalid QTI format error", err)
	}
}

func TestQuestionsImport_QuietSuppressesProgress(t *testing.T) {
	zipPath := newTempZipFile(t)

	summary := importSummary{Total: 1, Created: 1}
	srv := newQuestionsServer(t, questionsServerConfig{
		importHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(summary)
		},
	})
	defer srv.Close()

	setCfg(srv.URL, "test-key")
	resetQuestionsFlags()
	questionsImportFlags.bank = "bank-001"
	questionsImportFlags.file = zipPath
	questionsImportFlags.quiet = true

	var progressBuf bytes.Buffer
	questionsProgressOut = &progressBuf

	questionsImportCmd.SetOut(&bytes.Buffer{})
	if err := questionsImportCmd.RunE(questionsImportCmd, nil); err != nil {
		t.Fatalf("RunE: %v", err)
	}

	if strings.Contains(progressBuf.String(), "Importing") {
		t.Errorf("quiet mode should suppress 'Importing' message; got: %q", progressBuf.String())
	}
}

// ============================================================
// resolveContent
// ============================================================

func TestResolveContent_PlainString(t *testing.T) {
	got, err := resolveContent(`{"text":"hello"}`)
	if err != nil {
		t.Fatalf("resolveContent: %v", err)
	}
	if got != `{"text":"hello"}` {
		t.Errorf("got = %q, want original string", got)
	}
}

func TestResolveContent_AtFile(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "content-*.json")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	_, _ = f.WriteString(`{"text":"from file"}`)
	_ = f.Close()

	got, err := resolveContent("@" + f.Name())
	if err != nil {
		t.Fatalf("resolveContent: %v", err)
	}
	if got != `{"text":"from file"}` {
		t.Errorf("got = %q, want file content", got)
	}
}

func TestResolveContent_AtFileMissing(t *testing.T) {
	_, err := resolveContent("@/nonexistent/file.json")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

// ============================================================
// questionPreview
// ============================================================

func TestQuestionPreview_TextField(t *testing.T) {
	content := map[string]any{"text": "What is 2+2?"}
	got := questionPreview(content)
	if got != "What is 2+2?" {
		t.Errorf("preview = %q, want 'What is 2+2?'", got)
	}
}

func TestQuestionPreview_QuestionField(t *testing.T) {
	content := map[string]any{"question": "Name the planets."}
	got := questionPreview(content)
	if got != "Name the planets." {
		t.Errorf("preview = %q, want 'Name the planets.'", got)
	}
}

func TestQuestionPreview_Truncated(t *testing.T) {
	content := map[string]any{"text": strings.Repeat("a", 80)}
	got := questionPreview(content)
	if len(got) > 64 { // 60 chars + "..."
		t.Errorf("preview too long: %d chars", len(got))
	}
	if !strings.HasSuffix(got, "...") {
		t.Errorf("preview = %q; should end with ...", got)
	}
}

func TestQuestionPreview_Empty(t *testing.T) {
	got := questionPreview(map[string]any{"choices": []string{"a", "b"}})
	if got != "" {
		t.Errorf("preview = %q; want empty for unknown content keys", got)
	}
}

// ============================================================
// questions command tree
// ============================================================

func TestQuestionsCmd_HasSubcommands(t *testing.T) {
	names := map[string]bool{}
	for _, sub := range questionsCmd.Commands() {
		names[sub.Name()] = true
	}
	for _, want := range []string{"list", "create", "import"} {
		if !names[want] {
			t.Errorf("questions subcommand %q not registered", want)
		}
	}
}

func TestQuestionsCmd_NeedsAuth(t *testing.T) {
	if !commandNeedsAuth(questionsCmd) {
		t.Error("questionsCmd should require auth")
	}
	for _, sub := range questionsCmd.Commands() {
		if !commandNeedsAuth(sub) {
			t.Errorf("questions %s should require auth", sub.Name())
		}
	}
}
