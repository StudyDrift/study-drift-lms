package cmd

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/lextures/lextures/clients/cli/internal/client"
	"github.com/spf13/cobra"
)

// coursePublic mirrors the server's CoursePublic struct for JSON decoding.
type coursePublic struct {
	ID         string     `json:"id"`
	CourseCode string     `json:"courseCode"`
	Title      string     `json:"title"`
	Published  bool       `json:"published"`
	Archived   bool       `json:"archived"`
	CourseType string     `json:"courseType"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	StartsAt   *time.Time `json:"startsAt"`
	EndsAt     *time.Time `json:"endsAt"`
	OrgID      *string    `json:"orgId"`
	OrgUnitID  *string    `json:"orgUnitId"`
	TermID     *string    `json:"termId"`
}

type coursesListBody struct {
	Courses []coursePublic `json:"courses"`
}

var coursesCmd = &cobra.Command{
	Use:   "courses",
	Short: "Manage Lextures courses",
}

// --- courses list ---

var coursesListFlags struct {
	term  string
	limit int
	page  int
}

var coursesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List courses visible to the authenticated user",
	RunE:  runCoursesList,
}

func init() {
	coursesListCmd.Flags().StringVar(&coursesListFlags.term, "term", "", "filter by term UUID")
	coursesListCmd.Flags().IntVar(&coursesListFlags.limit, "limit", 50, "maximum number of results per page")
	coursesListCmd.Flags().IntVar(&coursesListFlags.page, "page", 1, "page number (1-based)")
}

func runCoursesList(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	path := "/api/v1/courses"
	params := []string{}
	if coursesListFlags.term != "" {
		params = append(params, "term_id="+coursesListFlags.term)
	}
	if len(params) > 0 {
		path += "?" + strings.Join(params, "&")
	}

	req, err := c.NewRequest(http.MethodGet, path, nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("listing courses: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	var body coursesListBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	// Client-side pagination over the returned slice.
	courses := body.Courses
	limit := coursesListFlags.limit
	page := coursesListFlags.page
	if limit > 0 && page > 0 {
		start := (page - 1) * limit
		if start >= len(courses) {
			courses = []coursePublic{}
		} else {
			end := start + limit
			if end > len(courses) {
				end = len(courses)
			}
			courses = courses[start:end]
		}
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(courses)
	}

	w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "CODE\tTITLE\tTYPE\tPUBLISHED\tARCHIVED")
	for _, co := range courses {
		fmt.Fprintf(w, "%s\t%s\t%s\t%v\t%v\n",
			co.CourseCode, co.Title, co.CourseType, co.Published, co.Archived)
	}
	return w.Flush()
}

// --- courses get ---

var coursesGetCmd = &cobra.Command{
	Use:   "get <course_code>",
	Short: "Get full details for a course",
	Args:  cobra.ExactArgs(1),
	RunE:  runCoursesGet,
}

func runCoursesGet(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	req, err := c.NewRequest(http.MethodGet, "/api/v1/courses/"+args[0], nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("getting course: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return apiError(resp, 2)
	}
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

	var co coursePublic
	if err := json.Unmarshal(body, &co); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	out := cmd.OutOrStdout()
	fmt.Fprintf(out, "Code:       %s\n", co.CourseCode)
	fmt.Fprintf(out, "Title:      %s\n", co.Title)
	fmt.Fprintf(out, "Type:       %s\n", co.CourseType)
	fmt.Fprintf(out, "Published:  %v\n", co.Published)
	fmt.Fprintf(out, "Archived:   %v\n", co.Archived)
	if co.StartsAt != nil {
		fmt.Fprintf(out, "Starts at:  %s\n", co.StartsAt.Format(time.RFC3339))
	}
	if co.EndsAt != nil {
		fmt.Fprintf(out, "Ends at:    %s\n", co.EndsAt.Format(time.RFC3339))
	}
	fmt.Fprintf(out, "Created:    %s\n", co.CreatedAt.Format(time.RFC3339))
	fmt.Fprintf(out, "Updated:    %s\n", co.UpdatedAt.Format(time.RFC3339))
	return nil
}

// --- courses create ---

var coursesCreateFlags struct {
	title       string
	description string
	orgUnitID   string
	termID      string
	courseType  string
}

var coursesCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new course",
	RunE:  runCoursesCreate,
}

func init() {
	coursesCreateCmd.Flags().StringVar(&coursesCreateFlags.title, "title", "", "course title (required)")
	_ = coursesCreateCmd.MarkFlagRequired("title")
	coursesCreateCmd.Flags().StringVar(&coursesCreateFlags.description, "description", "", "course description")
	coursesCreateCmd.Flags().StringVar(&coursesCreateFlags.orgUnitID, "org-unit", "", "org unit UUID")
	coursesCreateCmd.Flags().StringVar(&coursesCreateFlags.termID, "term", "", "term UUID")
	coursesCreateCmd.Flags().StringVar(&coursesCreateFlags.courseType, "type", "traditional", "course type: traditional or competency_based")
}

func runCoursesCreate(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	body := map[string]any{
		"title":       coursesCreateFlags.title,
		"description": coursesCreateFlags.description,
		"courseType":  coursesCreateFlags.courseType,
	}
	if coursesCreateFlags.orgUnitID != "" {
		body["orgUnitId"] = coursesCreateFlags.orgUnitID
	}
	if coursesCreateFlags.termID != "" {
		body["termId"] = coursesCreateFlags.termID
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}

	req, err := c.NewRequest(http.MethodPost, "/api/v1/courses", bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("creating course: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return apiError(resp, 2)
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	if globalFlags.jsonOut {
		_, err = cmd.OutOrStdout().Write(respBody)
		return err
	}

	var co coursePublic
	if err := json.Unmarshal(respBody, &co); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Created course %s (%s)\n", co.CourseCode, co.ID)
	return nil
}

// --- courses delete ---

var coursesDeleteFlags struct {
	force bool
}

var coursesDeleteCmd = &cobra.Command{
	Use:   "delete <course_code>",
	Short: "Archive a course (soft delete)",
	Args:  cobra.ExactArgs(1),
	RunE:  runCoursesDelete,
}

func init() {
	coursesDeleteCmd.Flags().BoolVar(&coursesDeleteFlags.force, "force", false, "skip confirmation prompt")
}

// coursesDeleteInput is used in tests to inject a custom reader for the confirmation prompt.
var coursesDeleteInput io.Reader

func runCoursesDelete(cmd *cobra.Command, args []string) error {
	courseCode := args[0]

	if !coursesDeleteFlags.force {
		in := coursesDeleteInput
		if in == nil {
			in = os.Stdin
		}
		r := bufio.NewReader(in)
		fmt.Fprintf(cmd.OutOrStdout(), "Are you sure you want to delete course %q? (y/N) ", courseCode)
		line, _ := r.ReadString('\n')
		if !strings.EqualFold(strings.TrimSpace(line), "y") {
			fmt.Fprintln(cmd.OutOrStdout(), "Aborted.")
			return nil
		}
	}

	c := client.New(Cfg.Server, Cfg.APIKey)

	body, _ := json.Marshal(map[string]bool{"archived": true})
	req, err := c.NewRequest(http.MethodPatch, "/api/v1/courses/"+courseCode+"/archived", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("archiving course: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return apiError(resp, 2)
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return apiError(resp, 2)
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]string{"archived": courseCode})
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Archived course %s\n", courseCode)
	return nil
}

// --- helpers ---

// apiError reads an error response body and returns a formatted error.
// The caller should exit with the given code for API errors.
func apiError(resp *http.Response, _ int) error {
	body, _ := io.ReadAll(resp.Body)
	var apiResp struct {
		Message string `json:"message"`
		Error   string `json:"error"`
	}
	if json.Unmarshal(body, &apiResp) == nil {
		if apiResp.Message != "" {
			return fmt.Errorf("server error (%d): %s", resp.StatusCode, apiResp.Message)
		}
		if apiResp.Error != "" {
			return fmt.Errorf("server error (%d): %s", resp.StatusCode, apiResp.Error)
		}
	}
	return fmt.Errorf("server error (%d)", resp.StatusCode)
}

// doWithRetry executes req, retrying once with exponential backoff on network errors.
func doWithRetry(c *client.Client, req *http.Request) (*http.Response, error) {
	resp, err := c.Do(req)
	if err != nil {
		time.Sleep(500 * time.Millisecond)
		resp, err = c.Do(req)
	}
	return resp, err
}

func init() {
	coursesCmd.AddCommand(coursesListCmd, coursesGetCmd, coursesCreateCmd, coursesDeleteCmd)
	rootCmd.AddCommand(coursesCmd)
}
