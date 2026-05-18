package cmd

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"text/tabwriter"

	"github.com/lextures/lextures/clients/cli/internal/client"
	"github.com/spf13/cobra"
)

// gradeColumn is a column in the gradebook grid (assignment or quiz item).
type gradeColumn struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	MaxPoints *int   `json:"maxPoints"`
}

// gradeStudent is a student row in the gradebook grid.
type gradeStudent struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
}

// gradebookGrid is the response envelope for GET .../gradebook/grid.
type gradebookGrid struct {
	Students []gradeStudent              `json:"students"`
	Columns  []gradeColumn               `json:"columns"`
	Grades   map[string]map[string]string `json:"grades"`
}

var gradesCmd = &cobra.Command{
	Use:   "grades",
	Short: "Manage course grades",
}

// --- grades list ---

var gradesListFlags struct {
	course string
	user   string
	limit  int
	page   int
}

var gradesListCmd = &cobra.Command{
	Use:   "list",
	Short: "List grades for a course",
	RunE:  runGradesList,
}

func init() {
	gradesListCmd.Flags().StringVar(&gradesListFlags.course, "course", "", "course code (required)")
	_ = gradesListCmd.MarkFlagRequired("course")
	gradesListCmd.Flags().StringVar(&gradesListFlags.user, "user", "", "filter to a single student by user ID")
	gradesListCmd.Flags().IntVar(&gradesListFlags.limit, "limit", 50, "maximum results per page")
	gradesListCmd.Flags().IntVar(&gradesListFlags.page, "page", 1, "page number (1-based)")
}

func runGradesList(cmd *cobra.Command, _ []string) error {
	grid, err := fetchGradebookGrid(gradesListFlags.course)
	if err != nil {
		return err
	}

	// Build flat grade rows for output.
	type gradeRow struct {
		StudentID   string `json:"student_id"`
		StudentName string `json:"student_name"`
		ItemID      string `json:"item_id"`
		Title       string `json:"assignment_title"`
		Score       string `json:"score"`
		MaxPoints   string `json:"max_points"`
		Percentage  string `json:"percentage"`
	}

	colByID := make(map[string]gradeColumn, len(grid.Columns))
	for _, col := range grid.Columns {
		colByID[col.ID] = col
	}

	var rows []gradeRow
	for _, student := range grid.Students {
		if gradesListFlags.user != "" && student.UserID != gradesListFlags.user {
			continue
		}
		studentGrades := grid.Grades[student.UserID]
		for _, col := range grid.Columns {
			score := ""
			if studentGrades != nil {
				score = studentGrades[col.ID]
			}
			maxStr := "-"
			pctStr := "-"
			if col.MaxPoints != nil && *col.MaxPoints > 0 {
				maxStr = strconv.Itoa(*col.MaxPoints)
				if score != "" {
					if s, err := strconv.ParseFloat(score, 64); err == nil {
						pctStr = fmt.Sprintf("%.1f%%", s/float64(*col.MaxPoints)*100)
					}
				}
			}
			rows = append(rows, gradeRow{
				StudentID:   student.UserID,
				StudentName: student.DisplayName,
				ItemID:      col.ID,
				Title:       col.Title,
				Score:       score,
				MaxPoints:   maxStr,
				Percentage:  pctStr,
			})
		}
	}

	// Client-side pagination.
	limit := gradesListFlags.limit
	page := gradesListFlags.page
	if limit > 0 && page > 0 {
		start := (page - 1) * limit
		if start >= len(rows) {
			rows = []gradeRow{}
		} else {
			end := start + limit
			if end > len(rows) {
				end = len(rows)
			}
			rows = rows[start:end]
		}
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(rows)
	}

	w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "STUDENT\tASSIGNMENT\tSCORE\tMAX\t%\tSTATUS")
	for _, r := range rows {
		status := "ungraded"
		if r.Score != "" {
			status = "graded"
		}
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\n",
			r.StudentName, r.Title, r.Score, r.MaxPoints, r.Percentage, status)
	}
	return w.Flush()
}

// --- grades update ---

var gradesUpdateFlags struct {
	course  string
	user    string
	item    string
	score   float64
	comment string
}

var gradesUpdateCmd = &cobra.Command{
	Use:   "update",
	Short: "Grade a submission (update score for a student's assignment)",
	RunE:  runGradesUpdate,
}

func init() {
	gradesUpdateCmd.Flags().StringVar(&gradesUpdateFlags.course, "course", "", "course code (required)")
	_ = gradesUpdateCmd.MarkFlagRequired("course")
	gradesUpdateCmd.Flags().StringVar(&gradesUpdateFlags.user, "user", "", "student user ID (required)")
	_ = gradesUpdateCmd.MarkFlagRequired("user")
	gradesUpdateCmd.Flags().StringVar(&gradesUpdateFlags.item, "item", "", "assignment item UUID (required)")
	_ = gradesUpdateCmd.MarkFlagRequired("item")
	gradesUpdateCmd.Flags().Float64Var(&gradesUpdateFlags.score, "score", 0, "score to assign (required)")
	_ = gradesUpdateCmd.MarkFlagRequired("score")
	gradesUpdateCmd.Flags().StringVar(&gradesUpdateFlags.comment, "comment", "", "optional grading comment (informational only)")
}

func runGradesUpdate(cmd *cobra.Command, _ []string) error {
	if gradesUpdateFlags.score < 0 {
		return fmt.Errorf("score must be >= 0")
	}

	c := client.New(Cfg.Server, Cfg.APIKey)

	scoreStr := strconv.FormatFloat(gradesUpdateFlags.score, 'f', -1, 64)
	body, err := json.Marshal(map[string]any{
		"grades": map[string]map[string]string{
			gradesUpdateFlags.user: {
				gradesUpdateFlags.item: scoreStr,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}

	path := "/api/v1/courses/" + gradesUpdateFlags.course + "/gradebook/grades"
	req, err := c.NewRequest(http.MethodPut, path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("updating grade: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("permission denied (403): you do not have permission to update grades in this course")
	}
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]any{
			"user_id": gradesUpdateFlags.user,
			"item_id": gradesUpdateFlags.item,
			"score":   gradesUpdateFlags.score,
		})
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Grade updated: user %s, item %s → %s\n",
		gradesUpdateFlags.user, gradesUpdateFlags.item, scoreStr)
	return nil
}

// --- grades export ---

var gradesExportFlags struct {
	course string
	format string
	output string
}

var gradesExportCmd = &cobra.Command{
	Use:   "export",
	Short: "Export course grades (default format: csv)",
	RunE:  runGradesExport,
}

func init() {
	gradesExportCmd.Flags().StringVar(&gradesExportFlags.course, "course", "", "course code (required)")
	_ = gradesExportCmd.MarkFlagRequired("course")
	gradesExportCmd.Flags().StringVar(&gradesExportFlags.format, "format", "csv", "output format: csv or json")
	gradesExportCmd.Flags().StringVar(&gradesExportFlags.output, "output", "", "write output to this file path instead of stdout")
}

func runGradesExport(cmd *cobra.Command, _ []string) error {
	if gradesExportFlags.format != "csv" && gradesExportFlags.format != "json" {
		return fmt.Errorf("unsupported format %q: use csv or json", gradesExportFlags.format)
	}

	grid, err := fetchGradebookGrid(gradesExportFlags.course)
	if err != nil {
		return err
	}

	out := cmd.OutOrStdout()
	if gradesExportFlags.output != "" {
		f, err := os.OpenFile(gradesExportFlags.output, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			return fmt.Errorf("opening output file: %w", err)
		}
		defer func() { _ = f.Close() }()

		// Warn if file is world-readable (privacy requirement).
		if info, err := f.Stat(); err == nil {
			if info.Mode().Perm()&0o004 != 0 {
				_, _ = fmt.Fprintln(cmd.ErrOrStderr(), "warning: output file is world-readable; grade data is sensitive")
			}
		}
		out = f
	}

	if gradesExportFlags.format == "json" {
		return json.NewEncoder(out).Encode(grid)
	}

	// CSV: one row per (student, assignment) pair.
	w := csv.NewWriter(out)
	_ = w.Write([]string{
		"student_id", "student_name", "student_email",
		"assignment_title", "score", "max_points", "percentage",
		"submitted_at", "graded_at", "comment",
	})

	for _, student := range grid.Students {
		studentGrades := grid.Grades[student.UserID]
		for _, col := range grid.Columns {
			score := ""
			if studentGrades != nil {
				score = studentGrades[col.ID]
			}
			maxStr := ""
			pctStr := ""
			if col.MaxPoints != nil && *col.MaxPoints > 0 {
				maxStr = strconv.Itoa(*col.MaxPoints)
				if score != "" {
					if s, err := strconv.ParseFloat(score, 64); err == nil {
						pctStr = fmt.Sprintf("%.2f", s/float64(*col.MaxPoints)*100)
					}
				}
			}
			// student_email, submitted_at, graded_at, comment are not available from the grid endpoint.
			_ = w.Write([]string{
				student.UserID, student.DisplayName, "",
				col.Title, score, maxStr, pctStr,
				"", "", "",
			})
		}
	}
	w.Flush()
	return w.Error()
}

// fetchGradebookGrid calls GET /api/v1/courses/{code}/gradebook/grid and decodes the response.
func fetchGradebookGrid(courseCode string) (*gradebookGrid, error) {
	c := client.New(Cfg.Server, Cfg.APIKey)
	req, err := c.NewRequest(http.MethodGet,
		"/api/v1/courses/"+courseCode+"/gradebook/grid", nil)
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return nil, fmt.Errorf("fetching gradebook: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, apiError(resp, 2)
	}

	var grid gradebookGrid
	if err := json.NewDecoder(resp.Body).Decode(&grid); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return &grid, nil
}

func init() {
	gradesCmd.AddCommand(gradesListCmd, gradesUpdateCmd, gradesExportCmd)
	rootCmd.AddCommand(gradesCmd)
}
