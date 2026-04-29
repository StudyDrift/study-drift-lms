package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	md "github.com/JohannesKaufmann/html-to-markdown"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
	"github.com/lextures/lextures/server-new/internal/repos/rbac"
	"github.com/lextures/lextures/server-new/internal/repos/user"
)

// handleCourseImportCanvasWS is GET /api/v1/courses/{course_code}/import/canvas/ws.
func (d Deps) handleCourseImportCanvasWS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.JWTSigner == nil || d.Pool == nil {
			http.Error(w, "server misconfiguration", http.StatusServiceUnavailable)
			return
		}
		courseCode := chi.URLParam(r, "course_code")
		if courseCode == "" {
			http.Error(w, "missing course", http.StatusBadRequest)
			return
		}
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
		if err != nil {
			return
		}

		readAuthCtx, cancelAuth := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancelAuth()
		typ, b, err := c.Read(readAuthCtx)
		if err != nil || typ != websocket.MessageText {
			return
		}
		var m struct {
			AuthToken string `json:"authToken"`
		}
		if err := json.Unmarshal(b, &m); err != nil || m.AuthToken == "" {
			return
		}
		u, err := d.JWTSigner.Verify(m.AuthToken)
		if err != nil {
			return
		}
		uid, err := uuid.Parse(u.UserID)
		if err != nil {
			return
		}
		hasAccess, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, uid)
		if err != nil || !hasAccess {
			return
		}
		canImport, err := rbac.UserHasPermission(r.Context(), d.Pool, uid, "course:"+courseCode+":item:create")
		if err != nil || !canImport {
			return
		}

		var req canvasImportWSFirstMessage
		if err := json.Unmarshal(b, &req); err != nil {
			_ = wsWriteJSON(r.Context(), c, map[string]any{
				"type":    "error",
				"message": "Invalid JSON in the first message. Send authToken plus the former Canvas import POST body fields.",
			})
			return
		}
		if req.CanvasBaseURL == "" || req.CanvasCourseID == "" || req.AccessToken == "" {
			_ = wsWriteJSON(r.Context(), c, map[string]any{
				"type":    "error",
				"message": "Canvas base URL, course id, and access token are required.",
			})
			return
		}
		include := req.Include.withDefaults()
		emit := func(msg string) bool {
			return wsWriteJSON(r.Context(), c, map[string]any{"type": "progress", "message": msg}) == nil
		}
		if !emit("Connecting to Canvas...") {
			return
		}
		err = d.runCanvasImport(r.Context(), courseCode, req.Mode, req.CanvasBaseURL, req.CanvasCourseID, req.AccessToken, include, emit)
		if err != nil {
			_ = wsWriteJSON(r.Context(), c, map[string]any{"type": "error", "message": err.Error()})
			return
		}
		_ = wsWriteJSON(r.Context(), c, map[string]any{"type": "complete"})
	}
}

type canvasImportWSFirstMessage struct {
	AuthToken      string              `json:"authToken"`
	Mode           string              `json:"mode"`
	CanvasBaseURL  string              `json:"canvasBaseUrl"`
	CanvasCourseID string              `json:"canvasCourseId"`
	AccessToken    string              `json:"accessToken"`
	Include        canvasImportInclude `json:"include"`
}

type canvasImportInclude struct {
	Modules     bool `json:"modules"`
	Assignments bool `json:"assignments"`
	Quizzes     bool `json:"quizzes"`
	Enrollments bool `json:"enrollments"`
	Grades      bool `json:"grades"`
	Settings    bool `json:"settings"`
}

func (i canvasImportInclude) withDefaults() canvasImportInclude {
	if !i.Modules && !i.Assignments && !i.Quizzes && !i.Enrollments && !i.Grades && !i.Settings {
		return canvasImportInclude{Modules: true, Assignments: true, Quizzes: true, Enrollments: true, Grades: true, Settings: true}
	}
	return i
}

func wsWriteJSON(ctx context.Context, c *websocket.Conn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.Write(ctx, websocket.MessageText, b)
}

func (d Deps) runCanvasImport(
	ctx context.Context,
	courseCode, mode, canvasBaseURL, canvasCourseIDRaw, accessToken string,
	include canvasImportInclude,
	progress func(string) bool,
) error {
	if d.Pool == nil {
		return errors.New("server misconfiguration")
	}
	if mode != "erase" && mode != "mergeAdd" && mode != "overwrite" {
		return errors.New("Invalid import mode.")
	}
	canvasBase, err := normalizeCanvasBaseURL(canvasBaseURL, d.effectiveConfig().CanvasAllowedHostSuffixes)
	if err != nil {
		return err
	}
	canvasCourseID, err := strconv.ParseInt(strings.TrimSpace(canvasCourseIDRaw), 10, 64)
	if err != nil {
		return errors.New("Canvas course id must be a number (the id from the Canvas course URL).")
	}
	client := &http.Client{Timeout: 180 * time.Second}

	course, err := canvasGetObject(ctx, client, canvasBase, accessToken, fmt.Sprintf("courses/%d", canvasCourseID), url.Values{"include[]": []string{"syllabus_body"}})
	if err != nil {
		return err
	}
	if !progress("Loaded course details from Canvas.") {
		return context.Canceled
	}
	modules := []map[string]any{}
	if include.Modules {
		if !progress("Loading modules from Canvas...") {
			return context.Canceled
		}
		modules, err = canvasGetArrayPaginated(ctx, client, canvasBase, accessToken, fmt.Sprintf("courses/%d/modules", canvasCourseID), url.Values{"include[]": []string{"items"}})
		if err != nil {
			return err
		}
	}
	enrollmentRows := []map[string]any{}
	if include.Enrollments {
		if !progress("Loading Canvas enrollments...") {
			return context.Canceled
		}
		enrollmentRows, err = canvasGetArrayPaginated(ctx, client, canvasBase, accessToken, fmt.Sprintf("courses/%d/enrollments", canvasCourseID), url.Values{"state[]": []string{"active", "invited", "creation_pending"}})
		if err != nil {
			return err
		}
	}

	tx, err := d.Pool.Begin(ctx)
	if err != nil {
		return errors.New("Failed to start import transaction.")
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var courseID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM course.courses WHERE course_code = $1`, courseCode).Scan(&courseID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("Course not found or you do not have access.")
	}
	if err != nil {
		return errors.New("Failed to load course.")
	}

	if include.Settings {
		title := strAt(course, "name", "Imported Canvas course")
		desc := markdownFromHTML(strAt(course, "public_description", ""))
		if desc == "" {
			desc = markdownFromHTML(strAt(course, "syllabus_body", ""))
		}
		published := strAt(course, "workflow_state", "available") == "available"
		_, err = tx.Exec(ctx, `UPDATE course.courses SET title = $1, description = $2, published = $3, updated_at = NOW() WHERE id = $4`, title, desc, published, courseID)
		if err != nil {
			return errors.New("Failed to update course settings.")
		}
		syllabusHTML := strAt(course, "syllabus_body", "")
		if syllabusHTML != "" {
			sections, _ := json.Marshal([]map[string]string{{
				"id":       "canvas-syllabus",
				"heading":  "Syllabus",
				"markdown": markdownFromHTML(syllabusHTML),
			}})
			_, err = tx.Exec(ctx, `
				INSERT INTO course.course_syllabus (course_id, sections, require_syllabus_acceptance, updated_at)
				VALUES ($1, $2, false, NOW())
				ON CONFLICT (course_id) DO UPDATE SET sections = EXCLUDED.sections, updated_at = NOW()
			`, courseID, sections)
			if err != nil {
				return errors.New("Failed to update syllabus.")
			}
		}
	}

	if include.Modules && (mode == "erase" || mode == "overwrite") {
		if !progress("Clearing existing course modules...") {
			return context.Canceled
		}
		if _, err = tx.Exec(ctx, `DELETE FROM course.course_structure_items WHERE course_id = $1`, courseID); err != nil {
			return errors.New("Failed to clear existing module structure.")
		}
	}

	nextSort := 0
	_ = tx.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM course.course_structure_items WHERE course_id = $1`, courseID).Scan(&nextSort)
	if include.Modules {
		if !progress("Importing modules and items...") {
			return context.Canceled
		}
		for _, m := range modules {
			moduleID := uuid.New()
			title := strAt(m, "name", "Module")
			published := boolAt(m, "published", true)
			if _, err = tx.Exec(ctx, `
				INSERT INTO course.course_structure_items (id, course_id, sort_order, kind, title, parent_id, published, archived)
				VALUES ($1, $2, $3, 'module', $4, NULL, $5, false)
			`, moduleID, courseID, nextSort, title, published); err != nil {
				return errors.New("Failed to insert module item.")
			}
			nextSort++
			items := arrAt(m, "items")
			for _, it := range items {
				kind, bodyTable := mapCanvasTypeToKind(strAt(it, "type", ""))
				if kind == "" {
					continue
				}
				if kind == "assignment" && !include.Assignments {
					continue
				}
				if kind == "quiz" && !include.Quizzes {
					continue
				}
				itemID := uuid.New()
				itemTitle := strAt(it, "title", "Item")
				itemPublished := boolAt(it, "published", published)
				if _, err = tx.Exec(ctx, `
					INSERT INTO course.course_structure_items (id, course_id, sort_order, kind, title, parent_id, published, archived)
					VALUES ($1, $2, $3, $4, $5, $6, $7, false)
				`, itemID, courseID, nextSort, kind, itemTitle, moduleID, itemPublished); err != nil {
					return errors.New("Failed to insert module child item.")
				}
				nextSort++
				switch bodyTable {
				case "content":
					md := ""
					if kind == "content_page" {
						pageURL := strAt(it, "page_url", "")
						if pageURL != "" {
							page, e := canvasGetObject(ctx, client, canvasBase, accessToken, fmt.Sprintf("courses/%d/pages/%s", canvasCourseID, url.PathEscape(pageURL)), nil)
							if e == nil {
								md = markdownFromHTML(strAt(page, "body", ""))
							}
						}
					} else {
						link := strAt(it, "html_url", "")
						if link != "" {
							md = fmt.Sprintf("**%s**\n\n[Open in Canvas](%s)", itemTitle, link)
						}
					}
					if _, err = tx.Exec(ctx, `INSERT INTO course.module_content_pages (structure_item_id, markdown) VALUES ($1, $2)`, itemID, md); err != nil {
						return errors.New("Failed to save imported page content.")
					}
				case "assignment":
					markdown := ""
					if cid := int64At(it, "content_id"); cid > 0 {
						obj, e := canvasGetObject(ctx, client, canvasBase, accessToken, fmt.Sprintf("courses/%d/assignments/%d", canvasCourseID, cid), nil)
						if e == nil {
							markdown = markdownFromHTML(strAt(obj, "description", ""))
						}
					}
					if _, err = tx.Exec(ctx, `INSERT INTO course.module_assignments (structure_item_id, markdown) VALUES ($1, $2)`, itemID, markdown); err != nil {
						return errors.New("Failed to save imported assignment.")
					}
				case "quiz":
					markdown := ""
					var questions []coursemodulequiz.QuizQuestion
					if cid := int64At(it, "content_id"); cid > 0 {
						obj, e := canvasGetObject(ctx, client, canvasBase, accessToken, fmt.Sprintf("courses/%d/quizzes/%d", canvasCourseID, cid), nil)
						if e == nil {
							markdown = markdownFromHTML(strAt(obj, "description", ""))
						}
						qq, qe := canvasImportQuizQuestions(ctx, client, canvasBase, accessToken, canvasCourseID, cid)
						if qe != nil {
							return fmt.Errorf("Failed to load quiz questions from Canvas (quiz id %d): %w", cid, qe)
						}
						questions = qq
					}
					qJSON, mj := json.Marshal(questions)
					if mj != nil {
						return errors.New("Failed to encode imported quiz questions.")
					}
					if _, err = tx.Exec(ctx, `INSERT INTO course.module_quizzes (structure_item_id, markdown, questions_json) VALUES ($1, $2, $3)`, itemID, markdown, qJSON); err != nil {
						return errors.New("Failed to save imported quiz.")
					}
				case "external":
					raw := strAt(it, "external_url", "")
					if raw == "" {
						raw = strAt(it, "html_url", "")
					}
					if _, err = tx.Exec(ctx, `INSERT INTO course.module_external_links (structure_item_id, url) VALUES ($1, $2)`, itemID, raw); err != nil {
						return errors.New("Failed to save imported external link.")
					}
				}
			}
		}
	}

	if include.Enrollments {
		if !progress("Applying enrollments from Canvas...") {
			return context.Canceled
		}
		for _, e := range enrollmentRows {
			u := objAt(e, "user")
			email := strings.ToLower(strings.TrimSpace(strAt(u, "email", "")))
			if email == "" {
				email = strings.ToLower(strings.TrimSpace(strAt(u, "login_id", "")))
			}
			if !strings.Contains(email, "@") {
				continue
			}
			usr, ue := user.FindByEmailCI(ctx, d.Pool, email)
			if ue != nil || usr == nil {
				continue
			}
			userID, pe := uuid.Parse(usr.ID)
			if pe != nil {
				continue
			}
			role := "student"
			if strings.Contains(strings.ToLower(strAt(e, "type", "")), "teacher") || strings.Contains(strings.ToLower(strAt(e, "type", "")), "ta") {
				role = "instructor"
			}
			_, _ = tx.Exec(ctx, `
				INSERT INTO course.course_enrollments (course_id, user_id, role)
				VALUES ($1, $2, $3)
				ON CONFLICT (course_id, user_id) DO UPDATE SET role = EXCLUDED.role
				WHERE course.course_enrollments.role <> 'owner'
			`, courseID, userID, role)
		}
	}

	if !progress("Saving imported content into your course...") {
		return context.Canceled
	}
	if err = tx.Commit(ctx); err != nil {
		return errors.New("Something went wrong while saving the import.")
	}
	return nil
}

func normalizeCanvasBaseURL(raw string, allowedHostSuffixes []string) (string, error) {
	t := strings.TrimSpace(strings.TrimRight(raw, "/"))
	if t == "" {
		return "", errors.New("Canvas base URL is required.")
	}
	u, err := url.Parse(t)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", errors.New("Canvas base URL must be a valid URL (https recommended).")
	}
	if u.Scheme != "https" {
		return "", errors.New("Canvas base URL must use https.")
	}
	host := strings.ToLower(u.Hostname())
	if net.ParseIP(host) != nil {
		return "", errors.New("Canvas base URL must use a DNS hostname, not an IP address.")
	}
	ok := false
	for _, suffix := range allowedHostSuffixes {
		s := strings.ToLower(strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(suffix), "*."), "."))
		if s != "" && (host == s || strings.HasSuffix(host, "."+s)) {
			ok = true
			break
		}
	}
	if !ok {
		return "", errors.New("Canvas base URL host is not allowed by server policy.")
	}
	return u.Scheme + "://" + u.Host, nil
}

func canvasGetArrayPaginated(ctx context.Context, client *http.Client, base, token, path string, q url.Values) ([]map[string]any, error) {
	out := make([]map[string]any, 0)
	for page := 1; ; page++ {
		qp := cloneQuery(q)
		qp.Set("per_page", "100")
		qp.Set("page", strconv.Itoa(page))
		arr, err := canvasGetArray(ctx, client, base, token, path, qp)
		if err != nil {
			return nil, err
		}
		if len(arr) == 0 {
			break
		}
		out = append(out, arr...)
		if len(arr) < 100 {
			break
		}
	}
	return out, nil
}

func canvasGetArray(ctx context.Context, client *http.Client, base, token, path string, q url.Values) ([]map[string]any, error) {
	v, err := canvasGetJSON(ctx, client, base, token, path, q)
	if err != nil {
		return nil, err
	}
	raw, ok := v.([]any)
	if !ok {
		return nil, errors.New("Unexpected Canvas response (expected array).")
	}
	out := make([]map[string]any, 0, len(raw))
	for _, it := range raw {
		if m, ok := it.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out, nil
}

func canvasGetObject(ctx context.Context, client *http.Client, base, token, path string, q url.Values) (map[string]any, error) {
	v, err := canvasGetJSON(ctx, client, base, token, path, q)
	if err != nil {
		return nil, err
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, errors.New("Unexpected Canvas response (expected object).")
	}
	return m, nil
}

func canvasGetJSON(ctx context.Context, client *http.Client, base, token, path string, q url.Values) (any, error) {
	u := fmt.Sprintf("%s/api/v1/%s", strings.TrimRight(base, "/"), strings.TrimLeft(path, "/"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, errors.New("Failed to build Canvas request.")
	}
	if q != nil {
		req.URL.RawQuery = q.Encode()
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("Could not reach Canvas (network error). Check the base URL and try again.")
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, errors.New("Canvas rejected the access token (401). Create a token with read access and try again.")
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, errors.New("Canvas returned 404 for this course or endpoint. Check the course id and token scope.")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("Canvas API error HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, errors.New("Canvas returned invalid JSON.")
	}
	return out, nil
}

func cloneQuery(v url.Values) url.Values {
	out := url.Values{}
	for k, vals := range v {
		cp := make([]string, len(vals))
		copy(cp, vals)
		out[k] = cp
	}
	return out
}

func strAt(m map[string]any, k, def string) string {
	if m == nil {
		return def
	}
	if v, ok := m[k].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func boolAt(m map[string]any, k string, def bool) bool {
	if m == nil {
		return def
	}
	if v, ok := m[k].(bool); ok {
		return v
	}
	return def
}

func int64At(m map[string]any, k string) int64 {
	if m == nil {
		return 0
	}
	switch v := m[k].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		return n
	default:
		return 0
	}
}

func objAt(m map[string]any, k string) map[string]any {
	if m == nil {
		return nil
	}
	if v, ok := m[k].(map[string]any); ok {
		return v
	}
	return nil
}

func arrAt(m map[string]any, k string) []map[string]any {
	if m == nil {
		return nil
	}
	raw, ok := m[k].([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(raw))
	for _, v := range raw {
		if mm, ok := v.(map[string]any); ok {
			out = append(out, mm)
		}
	}
	return out
}

func markdownFromHTML(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	converter := md.NewConverter("", true, nil)
	out, err := converter.ConvertString(s)
	if err == nil {
		out = strings.TrimSpace(out)
		if out != "" {
			return out
		}
	}
	return htmlToPlainText(s)
}

var (
	htmlBRTagRe  = regexp.MustCompile(`(?i)<br\s*/?>`)
	htmlPCloseRe = regexp.MustCompile(`(?i)</p\s*>`)
	htmlAnyTagRe = regexp.MustCompile(`<[^>]+>`)
)

func htmlToPlainText(html string) string {
	s := htmlBRTagRe.ReplaceAllString(html, "\n")
	s = htmlPCloseRe.ReplaceAllString(s, "\n\n")
	s = htmlAnyTagRe.ReplaceAllString(s, "")
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		t := strings.TrimSpace(line)
		if t == "" {
			if b.Len() == 0 || strings.HasSuffix(b.String(), "\n\n") {
				continue
			}
			b.WriteString("\n")
			continue
		}
		if b.Len() > 0 && !strings.HasSuffix(b.String(), "\n") {
			b.WriteString("\n")
		}
		b.WriteString(t)
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String())
}

func mapCanvasTypeToKind(t string) (kind string, bodyTable string) {
	switch t {
	case "SubHeader":
		return "heading", ""
	case "Page":
		return "content_page", "content"
	case "Assignment":
		return "assignment", "assignment"
	case "Quiz":
		return "quiz", "quiz"
	case "ExternalUrl", "ExternalTool", "File":
		return "external_link", "external"
	case "Discussion":
		return "content_page", "content"
	default:
		return "", ""
	}
}
