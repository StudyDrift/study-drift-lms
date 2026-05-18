package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"

	"github.com/lextures/lextures/clients/cli/internal/client"
	"github.com/spf13/cobra"
)

// questionPublic mirrors a question returned by the question bank API.
type questionPublic struct {
	ID      string         `json:"id"`
	BankID  string         `json:"bankId"`
	Type    string         `json:"type"`
	Content map[string]any `json:"content"`
}

// importSummary is the response from POST /api/question-banks/:bank_id/import.
type importSummary struct {
	Total   int      `json:"total"`
	Created int      `json:"created"`
	Skipped int      `json:"skipped"`
	Failed  int      `json:"failed"`
	Errors  []string `json:"errors"`
}

// questionPreview returns the first 60 chars of the question text from content.
func questionPreview(content map[string]any) string {
	for _, key := range []string{"text", "question", "stem"} {
		if v, ok := content[key]; ok {
			s := fmt.Sprintf("%v", v)
			if len(s) > 60 {
				return s[:60] + "..."
			}
			return s
		}
	}
	return ""
}

// resolveContent returns the content string; if it starts with @, reads from that file.
func resolveContent(s string) (string, error) {
	if !strings.HasPrefix(s, "@") {
		return s, nil
	}
	path := filepath.Clean(s[1:])
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("reading content file %s: %w", path, err)
	}
	return string(data), nil
}

var questionsCmd = &cobra.Command{
	Use:   "questions",
	Short: "Manage question bank questions",
}

// --- questions list ---

var questionsListFlags struct {
	bank  string
	qtype string
	limit int
	page  int
}

var questionsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List questions in a question bank",
	RunE:  runQuestionsList,
}

func init() {
	questionsListCmd.Flags().StringVar(&questionsListFlags.bank, "bank", "", "question bank ID (required)")
	_ = questionsListCmd.MarkFlagRequired("bank")
	questionsListCmd.Flags().StringVar(&questionsListFlags.qtype, "type", "", "filter by question type")
	questionsListCmd.Flags().IntVar(&questionsListFlags.limit, "limit", 50, "maximum results per page")
	questionsListCmd.Flags().IntVar(&questionsListFlags.page, "page", 1, "page number (1-based)")
}

func runQuestionsList(cmd *cobra.Command, _ []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	path := "/api/question-banks/" + questionsListFlags.bank + "/questions"
	req, err := c.NewRequest(http.MethodGet, path, nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	q := req.URL.Query()
	if questionsListFlags.qtype != "" {
		q.Set("type", questionsListFlags.qtype)
	}
	q.Set("limit", fmt.Sprintf("%d", questionsListFlags.limit))
	q.Set("page", fmt.Sprintf("%d", questionsListFlags.page))
	req.URL.RawQuery = q.Encode()

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("listing questions: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	var questions []questionPublic
	if err := json.NewDecoder(resp.Body).Decode(&questions); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(questions)
	}

	w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "ID\tTYPE\tPREVIEW")
	for _, q := range questions {
		preview := questionPreview(q.Content)
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\n", q.ID, q.Type, preview)
	}
	return w.Flush()
}

// --- questions create ---

var questionsCreateFlags struct {
	bank    string
	qtype   string
	content string
}

var questionsCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a question in a question bank",
	RunE:  runQuestionsCreate,
}

func init() {
	questionsCreateCmd.Flags().StringVar(&questionsCreateFlags.bank, "bank", "", "question bank ID (required)")
	_ = questionsCreateCmd.MarkFlagRequired("bank")
	questionsCreateCmd.Flags().StringVar(&questionsCreateFlags.qtype, "type", "", "question type: multiple-choice, true-false, short-answer, essay (required)")
	_ = questionsCreateCmd.MarkFlagRequired("type")
	questionsCreateCmd.Flags().StringVar(&questionsCreateFlags.content, "content", "", "question content as JSON string or @filename (required)")
	_ = questionsCreateCmd.MarkFlagRequired("content")
}

var validQuestionTypes = map[string]bool{
	"multiple-choice": true,
	"true-false":      true,
	"short-answer":    true,
	"essay":           true,
}

func runQuestionsCreate(cmd *cobra.Command, _ []string) error {
	if !validQuestionTypes[questionsCreateFlags.qtype] {
		return fmt.Errorf("invalid question type %q: use multiple-choice, true-false, short-answer, or essay",
			questionsCreateFlags.qtype)
	}

	contentStr, err := resolveContent(questionsCreateFlags.content)
	if err != nil {
		return err
	}

	var content map[string]any
	if err := json.Unmarshal([]byte(contentStr), &content); err != nil {
		return fmt.Errorf("parsing content JSON: %w", err)
	}

	body, err := json.Marshal(map[string]any{
		"type":    questionsCreateFlags.qtype,
		"content": content,
	})
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}

	c := client.New(Cfg.Server, Cfg.APIKey)
	path := "/api/question-banks/" + questionsCreateFlags.bank + "/questions"
	req, err := c.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("creating question: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated {
		return apiError(resp, 2)
	}

	var q questionPublic
	if err := json.NewDecoder(resp.Body).Decode(&q); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]string{
			"id":   q.ID,
			"type": q.Type,
		})
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Created question %s\n", q.ID)
	return nil
}

// --- questions import ---

var questionsImportFlags struct {
	bank  string
	file  string
	quiet bool
}

var questionsImportCmd = &cobra.Command{
	Use:   "import",
	Short: "Import questions from a QTI .zip package",
	RunE:  runQuestionsImport,
}

func init() {
	questionsImportCmd.Flags().StringVar(&questionsImportFlags.bank, "bank", "", "question bank ID (required)")
	_ = questionsImportCmd.MarkFlagRequired("bank")
	questionsImportCmd.Flags().StringVar(&questionsImportFlags.file, "file", "", "path to QTI .zip file (required)")
	_ = questionsImportCmd.MarkFlagRequired("file")
	questionsImportCmd.Flags().BoolVar(&questionsImportFlags.quiet, "quiet", false, "suppress progress output")
}

// questionsProgressOut allows tests to capture progress output.
var questionsProgressOut io.Writer

func runQuestionsImport(cmd *cobra.Command, _ []string) error {
	filePath := questionsImportFlags.file

	cleanPath := filepath.Clean(filePath)
	if strings.Contains(cleanPath, "..") {
		return fmt.Errorf("invalid file path: %s", filePath)
	}

	info, err := os.Stat(cleanPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("file not found: %s", filePath)
		}
		return fmt.Errorf("accessing file %s: %w", filePath, err)
	}

	if !strings.HasSuffix(strings.ToLower(cleanPath), ".zip") {
		return fmt.Errorf("file must be a .zip QTI package: %s", filePath)
	}

	f, err := os.Open(cleanPath)
	if err != nil {
		return fmt.Errorf("opening file: %w", err)
	}
	defer func() { _ = f.Close() }()

	progressOut := questionsProgressOut
	if progressOut == nil {
		progressOut = cmd.OutOrStdout()
	}

	if !questionsImportFlags.quiet {
		_, _ = fmt.Fprintf(progressOut, "Importing %s (%s)...\n",
			filepath.Base(cleanPath), formatFileSize(info.Size()))
	}

	pr, pw := io.Pipe()
	mw := multipart.NewWriter(pw)
	contentType := mw.FormDataContentType()

	go func() {
		defer func() { _ = pw.Close() }()
		defer func() { _ = mw.Close() }()

		fw, fwErr := mw.CreateFormFile("file", filepath.Base(cleanPath))
		if fwErr != nil {
			_ = pw.CloseWithError(fwErr)
			return
		}
		if _, copyErr := io.Copy(fw, f); copyErr != nil {
			_ = pw.CloseWithError(copyErr)
		}
	}()

	c := client.New(Cfg.Server, Cfg.APIKey)
	path := "/api/question-banks/" + questionsImportFlags.bank + "/import"
	req, err := c.NewRequest(http.MethodPost, path, pr)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("importing: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return apiError(resp, 2)
	}

	var summary importSummary
	if err := json.NewDecoder(resp.Body).Decode(&summary); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(summary)
	}

	for _, e := range summary.Errors {
		_, _ = fmt.Fprintf(progressOut, "  error: %s\n", e)
	}

	if summary.Failed > 0 {
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Imported %d/%d questions (%d skipped, %d failed)\n",
			summary.Created, summary.Total, summary.Skipped, summary.Failed)
	} else {
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Imported %d/%d questions (%d skipped)\n",
			summary.Created, summary.Total, summary.Skipped)
	}

	if summary.Failed > 0 && summary.Created == 0 {
		return fmt.Errorf("all %d questions failed to import", summary.Failed)
	}
	return nil
}

func init() {
	questionsCmd.AddCommand(questionsListCmd, questionsCreateCmd, questionsImportCmd)
	rootCmd.AddCommand(questionsCmd)
}
