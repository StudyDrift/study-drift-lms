package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"text/tabwriter"
	"time"

	"github.com/lextures/lextures/clients/cli/internal/client"
	"github.com/spf13/cobra"
)

type userPublic struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
}

type usersListBody struct {
	Users []userPublic `json:"users"`
}

var usersCmd = &cobra.Command{
	Use:   "users",
	Short: "Manage Lextures users",
}

// --- users list ---

var usersListFlags struct {
	org   string
	role  string
	limit int
	page  int
}

var usersListCmd = &cobra.Command{
	Use:   "list",
	Short: "List users visible to the authenticated user",
	RunE:  runUsersList,
}

func init() {
	usersListCmd.Flags().StringVar(&usersListFlags.org, "org", "", "filter by org UUID")
	usersListCmd.Flags().StringVar(&usersListFlags.role, "role", "", "filter by role (student, instructor, ta)")
	usersListCmd.Flags().IntVar(&usersListFlags.limit, "limit", 50, "maximum number of results per page")
	usersListCmd.Flags().IntVar(&usersListFlags.page, "page", 1, "page number (1-based)")
}

func runUsersList(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	params := url.Values{}
	if usersListFlags.org != "" {
		params.Set("org", usersListFlags.org)
	}
	if usersListFlags.role != "" {
		params.Set("role", usersListFlags.role)
	}
	if usersListFlags.limit > 0 {
		params.Set("limit", fmt.Sprintf("%d", usersListFlags.limit))
	}
	if usersListFlags.page > 0 {
		params.Set("page", fmt.Sprintf("%d", usersListFlags.page))
	}

	path := "/api/users"
	if len(params) > 0 {
		path += "?" + params.Encode()
	}

	req, err := c.NewRequest(http.MethodGet, path, nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("listing users: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	var body usersListBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(body.Users)
	}

	w := tabwriter.NewWriter(cmd.OutOrStdout(), 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "ID\tNAME\tEMAIL\tROLE\tCREATED")
	for _, u := range body.Users {
		_, _ = fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n",
			u.ID, u.Name, u.Email, u.Role, u.CreatedAt.Format(time.RFC3339))
	}
	return w.Flush()
}

// --- users get ---

var usersGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get details for a user (UUID or email)",
	Args:  cobra.ExactArgs(1),
	RunE:  runUsersGet,
}

func runUsersGet(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	req, err := c.NewRequest(http.MethodGet, "/api/users/"+url.PathEscape(args[0]), nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("getting user: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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

	var u userPublic
	if err := json.Unmarshal(body, &u); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}

	out := cmd.OutOrStdout()
	_, _ = fmt.Fprintf(out, "ID:       %s\n", u.ID)
	_, _ = fmt.Fprintf(out, "Name:     %s\n", u.Name)
	_, _ = fmt.Fprintf(out, "Email:    %s\n", u.Email)
	_, _ = fmt.Fprintf(out, "Role:     %s\n", u.Role)
	_, _ = fmt.Fprintf(out, "Created:  %s\n", u.CreatedAt.Format(time.RFC3339))
	return nil
}

// --- users create ---

var usersCreateFlags struct {
	email string
	name  string
	role  string
}

var usersCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Provision a new user account",
	RunE:  runUsersCreate,
}

func init() {
	usersCreateCmd.Flags().StringVar(&usersCreateFlags.email, "email", "", "user email address (required)")
	_ = usersCreateCmd.MarkFlagRequired("email")
	usersCreateCmd.Flags().StringVar(&usersCreateFlags.name, "name", "", "display name (required)")
	_ = usersCreateCmd.MarkFlagRequired("name")
	usersCreateCmd.Flags().StringVar(&usersCreateFlags.role, "role", "student", "role: student, instructor, or ta")
}

func runUsersCreate(cmd *cobra.Command, args []string) error {
	c := client.New(Cfg.Server, Cfg.APIKey)

	body := map[string]any{
		"email": usersCreateFlags.email,
		"name":  usersCreateFlags.name,
		"role":  usersCreateFlags.role,
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}

	req, err := c.NewRequest(http.MethodPost, "/api/users", bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("creating user: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusConflict {
		return fmt.Errorf("user with email %q already exists", usersCreateFlags.email)
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

	var u userPublic
	if err := json.Unmarshal(respBody, &u); err != nil {
		return fmt.Errorf("decoding response: %w", err)
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Created user %s (%s)\n", u.Email, u.ID)
	return nil
}

// --- users enroll ---

var usersEnrollFlags struct {
	course string
	user   string
	role   string
	dryRun bool
}

var usersEnrollCmd = &cobra.Command{
	Use:   "enroll",
	Short: "Enroll a user into a course with a role",
	RunE:  runUsersEnroll,
}

func init() {
	usersEnrollCmd.Flags().StringVar(&usersEnrollFlags.course, "course", "", "course ID (required)")
	_ = usersEnrollCmd.MarkFlagRequired("course")
	usersEnrollCmd.Flags().StringVar(&usersEnrollFlags.user, "user", "", "user UUID or email (required)")
	_ = usersEnrollCmd.MarkFlagRequired("user")
	usersEnrollCmd.Flags().StringVar(&usersEnrollFlags.role, "role", "", "role: student, instructor, or ta (required)")
	_ = usersEnrollCmd.MarkFlagRequired("role")
	usersEnrollCmd.Flags().BoolVar(&usersEnrollFlags.dryRun, "dry-run", false, "print what would happen without making API calls")
}

func runUsersEnroll(cmd *cobra.Command, args []string) error {
	if usersEnrollFlags.dryRun {
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Would enroll user %q as %s in course %s\n",
			usersEnrollFlags.user, usersEnrollFlags.role, usersEnrollFlags.course)
		return nil
	}

	c := client.New(Cfg.Server, Cfg.APIKey)

	userID, userName, err := resolveUserID(c, usersEnrollFlags.user)
	if err != nil {
		return fmt.Errorf("resolving user: %w", err)
	}

	body := map[string]any{
		"user_id": userID,
		"role":    usersEnrollFlags.role,
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}

	path := "/api/courses/" + url.PathEscape(usersEnrollFlags.course) + "/enrollments"
	req, err := c.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}

	resp, err := doWithRetry(c, req)
	if err != nil {
		return fmt.Errorf("enrolling user: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusConflict {
		_, _ = fmt.Fprintln(cmd.OutOrStdout(), "warning: already enrolled")
		return nil
	}
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return apiError(resp, 2)
	}

	if globalFlags.jsonOut {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]string{
			"enrolled": usersEnrollFlags.user,
			"course":   usersEnrollFlags.course,
			"role":     usersEnrollFlags.role,
		})
	}

	displayName := userName
	if displayName == "" {
		displayName = usersEnrollFlags.user
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Enrolled %s as %s in course %s\n",
		displayName, usersEnrollFlags.role, usersEnrollFlags.course)
	return nil
}

// resolveUserID returns the UUID for a user. If the input looks like a UUID it
// is returned as-is. Otherwise the value is treated as an email and a
// GET /api/users/<email> lookup is performed to obtain the UUID and name.
func resolveUserID(c *client.Client, idOrEmail string) (id, name string, err error) {
	if looksLikeUUID(idOrEmail) {
		return idOrEmail, "", nil
	}

	req, err := c.NewRequest(http.MethodGet, "/api/users/"+url.PathEscape(idOrEmail), nil)
	if err != nil {
		return "", "", err
	}
	resp, err := doWithRetry(c, req)
	if err != nil {
		return "", "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("user %q not found", idOrEmail)
	}
	var u userPublic
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return "", "", fmt.Errorf("decoding user: %w", err)
	}
	return u.ID, u.Name, nil
}

// looksLikeUUID returns true if s matches the UUID format (8-4-4-4-12 hex chars).
func looksLikeUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, ch := range s {
		switch i {
		case 8, 13, 18, 23:
			if ch != '-' {
				return false
			}
		default:
			if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') && (ch < 'A' || ch > 'F') {
				return false
			}
		}
	}
	return true
}

func init() {
	usersCmd.AddCommand(usersListCmd, usersGetCmd, usersCreateCmd, usersEnrollCmd)
	rootCmd.AddCommand(usersCmd)
}
