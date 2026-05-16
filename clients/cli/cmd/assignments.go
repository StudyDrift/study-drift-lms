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
	"time"

	"github.com/lextures/lextures/clients/cli/internal/client"
	"github.com/spf13/cobra"
)

// structureItemPublic is a subset of the course structure item response.
type structureItemPublic struct {
	ID          string     `json:"id"`
	SortOrder   int        `json:"sortOrder"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	ParentID    *string    `json:"parentId"`
	Published   bool       `json:"published"`
	DueAt       *time.Time `json:"dueAt"`
	PointsWorth *int       `json:"pointsWorth"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// assignmentPublic mirrors the GET /courses/{code}/assignments/{id} response.
type assignmentPublic struct {
	ItemID                    string     `json:"itemId"`
	Title                     string     `json:"title"`
	Markdown                  string     `json:"markdown"`
	DueAt                     *time.Time `json:"dueAt"`
	PointsWorth               *int       `json:"pointsWorth"`
	UpdatedAt                 time.Time  `json:"updatedAt"`
	SubmissionAllowText       *bool      `json:"submissionAllowText"`
	SubmissionAllowFileUpload *bool      `json:"submissionAllowFileUpload"`
	SubmissionAllowURL        *bool      `json:"submissionAllowUrl"`
}

// submissionReceipt is the response from a successful assignment submission.
type submissionReceipt struct {
	SubmissionID string    `json:"submission_id"`
	SubmittedAt  time.Time `json:"submitted_at"`
}

// courseStructureBody is the response envelope for GET /structure.
type courseStructureBody struct {
	Items []structureItemPublic `json:"items"`
}

var assignmentsCmd = &cobra.Command{
	Use:   "assignments",
	Short: "Manage Lextures assignments",
}

// --- assignments list ---

var assignmentsListFlags struct {
	course string
	limit  int
	page   int
}

var assignmentsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List assignments for a course",
	RunE:  runAssignmentsList,
}

func init() {
	assignmentsListCmd.Flags().StringVar(&assignmentsListFlags.course, "course", "", "course code (required)")
	_ = assignmentsListCmd.MarkFlagRequired("course")
	assignmentsListCmd.Flags().IntVar(&assignmentsListFlags.limit, "limit", 50, "maximum results per page")
	assignmentsListCmd.Flags().IntVar(&assignmentsListFlags.page, "page", 1, "page number (1-based)")
}

func runAssignmentsList(cmd *cobra.Command, _ []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	req, err := c.NewRequest(http.MethodGet,
		"/api/v1/courses/"+assignmentsListFlags.course+"/structure", nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("listing assignments: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	var body courseStructureBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	// Filter to assignment items only.
	var assignments []structureItemPublic
	for _, item := range body.Items {
		if item.Kind == "assignment" {
			assignments = append(assignments, item)
		}
	}

	// Client-side pagination.
	limit := assignmentsListFlags.limit
	page := assignmentsListFlags.page
	if limit > 0 && page > 0 {
		start := (page - 1) * limit
		if start >= len(assignments) {
			assignments = []structureItemPublic{}
		} else {
			end := start + limit
			if end > len(assignments) {
				end = len(assignments)
			}
			assignments = assignments[start:end]
		}
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(assignments)
	}

	w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "ID\tTITLE\tPOINTS\tDUE")
	for _, a := range assignments {
		points := "-"
		if a.PointsWorth != nil {
			points = fmt.Sprintf("%d", *a.PointsWorth)
		}
		due := "-"
		if a.DueAt != nil {
			due = a.DueAt.Format(time.RFC3339)
		}
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", a.ID, a.Title, points, due)
	}
	return w.Flush()
}

// --- assignments get ---

var assignmentsGetFlags struct {
	course string
}

var assignmentsGetCmd = &cobra.Command{
	Use:   "get <item_id>",
	Short: "Get assignment details",
	Args:  cobra.ExactArgs(1),
	RunE:  runAssignmentsGet,
}

func init() {
	assignmentsGetCmd.Flags().StringVar(&assignmentsGetFlags.course, "course", "", "course code (required)")
	_ = assignmentsGetCmd.MarkFlagRequired("course")
}

func runAssignmentsGet(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	req, err := c.NewRequest(http.MethodGet,
		"/api/v1/courses/"+assignmentsGetFlags.course+"/assignments/"+args[0], nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("getting assignment: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	if globalFlags.jsonOut {
		_, err = cmd.OutOrStdout().Write(body)
		return err
	}

	var a assignmentPublic
	if err := json.Unmarshal(body, &a); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	out := cmd.OutOrStdout()
	_, _ = fmt.Fprintf(out, "ID:          %s\n", a.ItemID)
	_, _ = fmt.Fprintf(out, "Title:       %s\n", a.Title)
	if a.PointsWorth != nil {
		_, _ = fmt.Fprintf(out, "Points:      %d\n", *a.PointsWorth)
	}
	if a.DueAt != nil {
		_, _ = fmt.Fprintf(out, "Due:         %s\n", a.DueAt.Format(time.RFC3339))
	}
	if a.SubmissionAllowText != nil {
		_, _ = fmt.Fprintf(out, "Allow text:  %v\n", *a.SubmissionAllowText)
	}
	if a.SubmissionAllowFileUpload != nil {
		_, _ = fmt.Fprintf(out, "Allow file:  %v\n", *a.SubmissionAllowFileUpload)
	}
	if a.SubmissionAllowURL != nil {
		_, _ = fmt.Fprintf(out, "Allow URL:   %v\n", *a.SubmissionAllowURL)
	}
	_, _ = fmt.Fprintf(out, "Updated:     %s\n", a.UpdatedAt.Format(time.RFC3339))
	return nil
}

// --- assignments create ---

var assignmentsCreateFlags struct {
	course string
	module string
	title  string
	// points uses -1 as sentinel for "not provided".
	points int
	due    string
}

var assignmentsCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new assignment under a module",
	RunE:  runAssignmentsCreate,
}

func init() {
	assignmentsCreateCmd.Flags().StringVar(&assignmentsCreateFlags.course, "course", "", "course code (required)")
	_ = assignmentsCreateCmd.MarkFlagRequired("course")
	assignmentsCreateCmd.Flags().StringVar(&assignmentsCreateFlags.module, "module", "", "module UUID (required)")
	_ = assignmentsCreateCmd.MarkFlagRequired("module")
	assignmentsCreateCmd.Flags().StringVar(&assignmentsCreateFlags.title, "title", "", "assignment title (required)")
	_ = assignmentsCreateCmd.MarkFlagRequired("title")
	// -1 means the flag was not provided.
	assignmentsCreateCmd.Flags().IntVar(&assignmentsCreateFlags.points, "points", -1, "point value for the assignment")
	assignmentsCreateCmd.Flags().StringVar(&assignmentsCreateFlags.due, "due", "", "due date in ISO 8601 (e.g. 2027-09-15 or 2027-09-15T23:59:00Z)")
}

func runAssignmentsCreate(cmd *cobra.Command, _ []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	// Step 1: Create the assignment structure item.
	createBody, err := json.Marshal(map[string]string{"title": assignmentsCreateFlags.title})
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}

	createPath := "/api/v1/courses/" + assignmentsCreateFlags.course +
		"/structure/modules/" + assignmentsCreateFlags.module + "/assignments"
	createReq, err := c.NewRequest(http.MethodPost, createPath, bytes.NewReader(createBody))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	createResp, err := doWithRetry(c, createReq)
	if err != nil {
		return fmt.Errorf("creating assignment: %w", err)
	}
	defer func() { _ = createResp.Body.Close() }()

	if createResp.StatusCode != http.StatusCreated {
		return apiError(createResp, 2)
	}

	var item structureItemPublic
	if err := json.NewDecoder(createResp.Body).Decode(&item); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	// Step 2: PATCH assignment if --points or --due were provided.
	hasPoints := assignmentsCreateFlags.points >= 0
	hasDue := strings.TrimSpace(assignmentsCreateFlags.due) != ""
	if hasPoints || hasDue {
		patch := map[string]any{
			"markdown":             "",
			"lateSubmissionPolicy": "allow",
			"postingPolicy":        "automatic",
		}
		if hasPoints {
			patch["pointsWorth"] = assignmentsCreateFlags.points
		}
		if hasDue {
			due, parseErr := parseAssignmentDue(assignmentsCreateFlags.due)
			if parseErr != nil {
				return parseErr
			}
			patch["dueAt"] = due.Format(time.RFC3339)
		}

		patchBody, err := json.Marshal(patch)
		if err != nil {
			return fmt.Errorf("encoding patch: %w", err)
		}

		patchPath := "/api/v1/courses/" + assignmentsCreateFlags.course + "/assignments/" + item.ID
		patchReq, err := c.NewRequest(http.MethodPatch, patchPath, bytes.NewReader(patchBody))
		if err != nil {
			return fmt.Errorf("building patch request: %w", err)
		}

		patchResp, err := doWithRetry(c, patchReq)
		if err != nil {
			return fmt.Errorf("updating assignment: %w", err)
		}
		defer func() { _ = patchResp.Body.Close() }()

		if patchResp.StatusCode != http.StatusOK {
			return apiError(patchResp, 2)
		}
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]string{
			"id":    item.ID,
			"title": item.Title,
		})
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Created assignment %s\n", item.ID)
	return nil
}

// parseAssignmentDue parses a due date accepting ISO 8601 datetime or date-only format.
func parseAssignmentDue(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}, fmt.Errorf(
			"invalid due date %q: use ISO 8601 (e.g. 2027-09-15 or 2027-09-15T23:59:00Z)", s)
	}
	// Date-only defaults to end of day UTC.
	return time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 0, 0, time.UTC), nil
}

// --- assignments submit ---

var assignmentsSubmitFlags struct {
	course     string
	assignment string
	file       string
	quiet      bool
}

var assignmentsSubmitCmd = &cobra.Command{
	Use:   "submit",
	Short: "Submit a file for an assignment",
	RunE:  runAssignmentsSubmit,
}

func init() {
	assignmentsSubmitCmd.Flags().StringVar(&assignmentsSubmitFlags.course, "course", "", "course code (required)")
	_ = assignmentsSubmitCmd.MarkFlagRequired("course")
	assignmentsSubmitCmd.Flags().StringVar(&assignmentsSubmitFlags.assignment, "assignment", "", "assignment item UUID (required)")
	_ = assignmentsSubmitCmd.MarkFlagRequired("assignment")
	assignmentsSubmitCmd.Flags().StringVar(&assignmentsSubmitFlags.file, "file", "", "path to file to submit (required)")
	_ = assignmentsSubmitCmd.MarkFlagRequired("file")
	assignmentsSubmitCmd.Flags().BoolVar(&assignmentsSubmitFlags.quiet, "quiet", false, "suppress progress output")
}

// assignmentsProgressOut allows tests to capture progress output.
var assignmentsProgressOut io.Writer

func runAssignmentsSubmit(cmd *cobra.Command, _ []string) error {
	filePath := assignmentsSubmitFlags.file

	// Validate file path (no path traversal) and existence before making any API call (FR-6).
	cleanPath := filepath.Clean(filePath)
	if strings.Contains(cleanPath, "..") {
		return fmt.Errorf("invalid file path: %s", filePath)
	}
	info, err := os.Stat(cleanPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("File not found: %s", filePath)
		}
		return fmt.Errorf("accessing file %s: %w", filePath, err)
	}
	fileSize := info.Size()

	f, err := os.Open(cleanPath)
	if err != nil {
		return fmt.Errorf("opening file: %w", err)
	}
	defer func() { _ = f.Close() }()

	progressOut := assignmentsProgressOut
	if progressOut == nil {
		progressOut = cmd.OutOrStdout()
	}

	if !assignmentsSubmitFlags.quiet {
		_, _ = fmt.Fprintf(progressOut, "Submitting %s (%s)...\n",
			filepath.Base(cleanPath), formatFileSize(fileSize))
	}

	// Build multipart body streamed via a pipe (avoids buffering large files in memory).
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

		var src io.Reader = f
		if !assignmentsSubmitFlags.quiet && fileSize > 1024*1024 {
			src = &assignmentProgressReader{
				r:     f,
				total: fileSize,
				out:   progressOut,
			}
		}
		if _, copyErr := io.Copy(fw, src); copyErr != nil {
			_ = pw.CloseWithError(copyErr)
		}
	}()

	c := client.New(Cfg.Server, Cfg.APIKey)
	path := "/api/v1/courses/" + assignmentsSubmitFlags.course +
		"/assignments/" + assignmentsSubmitFlags.assignment + "/submissions"

	// Use NewRequest for auth header injection, then override content-type.
	req, err := c.NewRequest(http.MethodPost, path, pr)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("submitting: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if !assignmentsSubmitFlags.quiet && fileSize > 1024*1024 {
		_, _ = fmt.Fprintln(progressOut)
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	if globalFlags.jsonOut {
		_, err = cmd.OutOrStdout().Write(body)
		return err
	}

	var receipt submissionReceipt
	if err := json.Unmarshal(body, &receipt); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	out := cmd.OutOrStdout()
	_, _ = fmt.Fprintf(out, "Submission ID: %s\n", receipt.SubmissionID)
	_, _ = fmt.Fprintf(out, "Submitted at:  %s\n", receipt.SubmittedAt.Format(time.RFC3339))
	return nil
}

// assignmentProgressReader streams a file while printing upload progress to out.
type assignmentProgressReader struct {
	r     io.Reader
	total int64
	read  int64
	out   io.Writer
}

func (p *assignmentProgressReader) Read(buf []byte) (n int, err error) {
	n, err = p.r.Read(buf)
	p.read += int64(n)
	if p.total > 0 {
		pct := p.read * 100 / p.total
		_, _ = fmt.Fprintf(p.out, "\rUploading... %3d%%", pct)
	}
	return
}

// formatFileSize returns a human-readable size string.
func formatFileSize(size int64) string {
	const mb = 1024 * 1024
	if size >= mb {
		return fmt.Sprintf("%.1f MB", float64(size)/float64(mb))
	}
	return fmt.Sprintf("%d KB", size/1024)
}

func init() {
	assignmentsCmd.AddCommand(assignmentsListCmd, assignmentsGetCmd, assignmentsCreateCmd, assignmentsSubmitCmd)
	rootCmd.AddCommand(assignmentsCmd)
}
