package cmd

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/lextures/lextures/clients/cli/internal/client"
	"github.com/spf13/cobra"
)

type orgPublic struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	UserCount   int64  `json:"userCount"`
	CourseCount int64  `json:"courseCount"`
}

type orgsListBody struct {
	Organizations []orgPublic `json:"organizations"`
}

var orgsCmd = &cobra.Command{
	Use:   "orgs",
	Short: "Manage Lextures organizations",
}

// --- orgs list ---

var orgsListFlags struct {
	limit int
	page  int
}

var orgsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all organizations (requires super-admin)",
	RunE:  runOrgsList,
}

func init() {
	orgsListCmd.Flags().IntVar(&orgsListFlags.limit, "limit", 50, "maximum number of results per page")
	orgsListCmd.Flags().IntVar(&orgsListFlags.page, "page", 1, "page number (1-based)")
}

func runOrgsList(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	params := url.Values{}
	limit := orgsListFlags.limit
	page := orgsListFlags.page
	if limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", limit))
	}
	if page > 1 && limit > 0 {
		params.Set("offset", fmt.Sprintf("%d", (page-1)*limit))
	}

	path := "/api/v1/admin/orgs"
	if len(params) > 0 {
		path += "?" + params.Encode()
	}

	req, err := c.NewRequest(http.MethodGet, path, nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("listing orgs: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("permission denied: super-admin role required")
	}
	if resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	var body orgsListBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(body.Organizations)
	}

	w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "ID\tNAME\tSLUG\tUSERS\tCOURSES\tCREATED")
	for _, o := range body.Organizations {
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%d\t%d\t%s\n",
			o.ID, o.Name, o.Slug, o.UserCount, o.CourseCount, o.CreatedAt)
	}
	return w.Flush()
}

// --- orgs get ---

var orgsGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get details for an organization (UUID or slug)",
	Args:  cobra.ExactArgs(1),
	RunE:  runOrgsGet,
}

func runOrgsGet(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)
	idOrSlug := args[0]

	var org *orgPublic
	var err error
	if looksLikeUUID(idOrSlug) {
		org, err = fetchOrgByID(c, idOrSlug)
	} else {
		org, err = fetchOrgBySlug(c, idOrSlug)
	}
	if err != nil {
		return err
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(org)
	}

	out := cmd.OutOrStdout()
	_, _ = fmt.Fprintf(out, "ID:       %s\n", org.ID)
	_, _ = fmt.Fprintf(out, "Name:     %s\n", org.Name)
	_, _ = fmt.Fprintf(out, "Slug:     %s\n", org.Slug)
	_, _ = fmt.Fprintf(out, "Status:   %s\n", org.Status)
	_, _ = fmt.Fprintf(out, "Users:    %d\n", org.UserCount)
	_, _ = fmt.Fprintf(out, "Courses:  %d\n", org.CourseCount)
	_, _ = fmt.Fprintf(out, "Created:  %s\n", org.CreatedAt)
	return nil
}

func fetchOrgByID(c *client.Client, id string) (*orgPublic, error) {
	req, err := c.NewRequest(http.MethodGet, "/api/v1/admin/orgs/"+url.PathEscape(id), nil)
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	resp, err := doWithRetry(c, req)
	if err != nil {
		return nil, fmt.Errorf("getting org: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("permission denied: super-admin role required")
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, apiError(resp, 2)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, apiError(resp, 2)
	}

	var org orgPublic
	if err := json.NewDecoder(resp.Body).Decode(&org); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return &org, nil
}

func fetchOrgBySlug(c *client.Client, slug string) (*orgPublic, error) {
	req, err := c.NewRequest(http.MethodGet, "/api/v1/admin/orgs?limit=1000", nil)
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	resp, err := doWithRetry(c, req)
	if err != nil {
		return nil, fmt.Errorf("listing orgs for slug lookup: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusForbidden {
		return nil, fmt.Errorf("permission denied: super-admin role required")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, apiError(resp, 2)
	}

	var body orgsListBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	for _, o := range body.Organizations {
		if strings.EqualFold(o.Slug, slug) {
			org := o
			return &org, nil
		}
	}
	return nil, fmt.Errorf("org with slug %q not found", slug)
}

// --- orgs create ---

var orgsCreateFlags struct {
	name  string
	force bool
}

// orgsCreateInput can be overridden in tests to inject a custom reader for the confirmation prompt.
var orgsCreateInput io.Reader

var orgsCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Provision a new organization (requires super-admin)",
	RunE:  runOrgsCreate,
}

func init() {
	orgsCreateCmd.Flags().StringVar(&orgsCreateFlags.name, "name", "", "organization name (required)")
	_ = orgsCreateCmd.MarkFlagRequired("name")
	orgsCreateCmd.Flags().BoolVar(&orgsCreateFlags.force, "force", false, "skip confirmation prompt")
}

func runOrgsCreate(cmd *cobra.Command, args []string) error {
	if !orgsCreateFlags.force {
		in := orgsCreateInput
		if in == nil {
			in = os.Stdin
		}
		r := bufio.NewReader(in)
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Create organization %q? [y/N] ", orgsCreateFlags.name)
		line, _ := r.ReadString('\n')
		if !strings.EqualFold(strings.TrimSpace(line), "y") {
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Aborted.")
			return nil
		}
	}

	c := client.New(Cfg.Server, Cfg.APIKey)

	raw, err := json.Marshal(map[string]any{"name": orgsCreateFlags.name})
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}

	req, err := c.NewRequest(http.MethodPost, "/api/v1/admin/orgs", bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("creating org: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("permission denied: super-admin role required")
	}
	if resp.StatusCode == http.StatusConflict {
		return fmt.Errorf("org with that slug already exists")
	}
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

	var org orgPublic
	if err := json.Unmarshal(respBody, &org); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Created org %s (id: %s, slug: %s)\n", org.Name, org.ID, org.Slug)
	return nil
}

func init() {
	orgsCmd.AddCommand(orgsListCmd, orgsGetCmd, orgsCreateCmd)
	rootCmd.AddCommand(orgsCmd)
}
