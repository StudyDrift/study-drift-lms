// Package discussions provides course discussion forums (plan 6.1).
package discussions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ForumRow is a discussion forum header.
type ForumRow struct {
	ID          uuid.UUID
	CourseID    uuid.UUID
	Name        string
	Description *string
	Position    int
	CreatedAt   time.Time
}

// ThreadRow lists metadata for a thread.
type ThreadRow struct {
	ID                        uuid.UUID
	ForumID                   uuid.UUID
	AssignmentStructureItemID *uuid.UUID
	AuthorID                  uuid.UUID
	Title                     string
	IsPinned                  bool
	IsLocked                  bool
	RequirePostFirst          bool
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
	ReplyCount                int
}

// ThreadDetail is a single thread with body JSON.
type ThreadDetail struct {
	ThreadRow
	Body json.RawMessage `json:"body"`
}

// PostRow is one discussion post.
type PostRow struct {
	ID            uuid.UUID
	ThreadID      uuid.UUID
	ParentPostID  *uuid.UUID
	AuthorID      uuid.UUID
	Body          json.RawMessage
	UpvoteCount   int
	CreatedAt     time.Time
	UpdatedAt     time.Time
	ViewerUpvoted bool `json:"viewerUpvoted"`
}

// ListForums returns forums for a course ordered by position.
func ListForums(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]ForumRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, course_id, name, description, position, created_at
FROM course.discussion_forums
WHERE course_id = $1
ORDER BY position ASC, created_at ASC
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ForumRow
	for rows.Next() {
		var r ForumRow
		var desc sql.NullString
		if err := rows.Scan(&r.ID, &r.CourseID, &r.Name, &desc, &r.Position, &r.CreatedAt); err != nil {
			return nil, err
		}
		if desc.Valid {
			s := desc.String
			r.Description = &s
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CreateForum inserts a forum row.
func CreateForum(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, name, description string, position int) (*ForumRow, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("empty forum name")
	}
	var desc any
	ds := strings.TrimSpace(description)
	if ds != "" {
		desc = ds
	} else {
		desc = nil
	}
	var r ForumRow
	var descOut sql.NullString
	err := pool.QueryRow(ctx, `
INSERT INTO course.discussion_forums (course_id, name, description, position)
VALUES ($1, $2, $3, $4)
RETURNING id, course_id, name, description, position, created_at
`, courseID, name, desc, position).Scan(&r.ID, &r.CourseID, &r.Name, &descOut, &r.Position, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	if descOut.Valid {
		s := descOut.String
		r.Description = &s
	}
	return &r, nil
}

// ForumBelongsToCourse returns true when the forum exists for the course.
func ForumBelongsToCourse(ctx context.Context, pool *pgxpool.Pool, courseID, forumID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM course.discussion_forums WHERE id = $1 AND course_id = $2)
`, forumID, courseID).Scan(&ok)
	return ok, err
}

// ThreadBelongsToCourse checks thread via forum course_id.
func ThreadBelongsToCourse(ctx context.Context, pool *pgxpool.Pool, courseID, threadID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM course.discussion_threads t
  INNER JOIN course.discussion_forums f ON f.id = t.forum_id
  WHERE t.id = $1 AND f.course_id = $2
)
`, threadID, courseID).Scan(&ok)
	return ok, err
}

// PostBelongsToCourse checks post via thread/forum.
func PostBelongsToCourse(ctx context.Context, pool *pgxpool.Pool, courseID, postID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM course.discussion_posts p
  INNER JOIN course.discussion_threads t ON t.id = p.thread_id
  INNER JOIN course.discussion_forums f ON f.id = t.forum_id
  WHERE p.id = $1 AND f.course_id = $2
)
`, postID, courseID).Scan(&ok)
	return ok, err
}

// ListThreads returns threads for a forum.
func ListThreads(ctx context.Context, pool *pgxpool.Pool, forumID uuid.UUID, limit int) ([]ThreadRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := pool.Query(ctx, `
SELECT
  t.id, t.forum_id, t.assignment_structure_item_id, t.author_id, t.title,
  t.is_pinned, t.is_locked, t.require_post_first, t.created_at, t.updated_at,
  COALESCE((SELECT COUNT(*)::int FROM course.discussion_posts p WHERE p.thread_id = t.id), 0)
FROM course.discussion_threads t
WHERE t.forum_id = $1
ORDER BY t.is_pinned DESC, t.updated_at DESC, t.created_at DESC
LIMIT $2
`, forumID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanThreadRows(rows)
}

func scanThreadRows(rows pgx.Rows) ([]ThreadRow, error) {
	var out []ThreadRow
	for rows.Next() {
		var r ThreadRow
		var assign *uuid.UUID
		if err := rows.Scan(
			&r.ID, &r.ForumID, &assign, &r.AuthorID, &r.Title,
			&r.IsPinned, &r.IsLocked, &r.RequirePostFirst, &r.CreatedAt, &r.UpdatedAt,
			&r.ReplyCount,
		); err != nil {
			return nil, err
		}
		r.AssignmentStructureItemID = assign
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetThread returns thread detail if it belongs to course.
func GetThread(ctx context.Context, pool *pgxpool.Pool, courseID, threadID uuid.UUID) (*ThreadDetail, error) {
	row := pool.QueryRow(ctx, `
SELECT
  t.id, t.forum_id, t.assignment_structure_item_id, t.author_id, t.title, t.body,
  t.is_pinned, t.is_locked, t.require_post_first, t.created_at, t.updated_at,
  COALESCE((SELECT COUNT(*)::int FROM course.discussion_posts p WHERE p.thread_id = t.id), 0)
FROM course.discussion_threads t
INNER JOIN course.discussion_forums f ON f.id = t.forum_id
WHERE t.id = $1 AND f.course_id = $2
`, threadID, courseID)
	var d ThreadDetail
	var assign *uuid.UUID
	var body []byte
	if err := row.Scan(
		&d.ID, &d.ForumID, &assign, &d.AuthorID, &d.Title, &body,
		&d.IsPinned, &d.IsLocked, &d.RequirePostFirst, &d.CreatedAt, &d.UpdatedAt,
		&d.ReplyCount,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	d.AssignmentStructureItemID = assign
	d.Body = json.RawMessage(body)
	return &d, nil
}

// CreateThread inserts a thread; assignmentStructureItemID must belong to the same course when set.
func CreateThread(ctx context.Context, pool *pgxpool.Pool, forumID, authorID uuid.UUID, title string, body json.RawMessage, assignmentStructureItemID *uuid.UUID, requirePostFirst bool) (*ThreadDetail, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, errors.New("empty title")
	}
	if !json.Valid(body) {
		return nil, errors.New("invalid thread body json")
	}
	var root map[string]any
	if err := json.Unmarshal(body, &root); err != nil || root == nil {
		return nil, errors.New("invalid thread body")
	}
	if ty, _ := root["type"].(string); ty != "doc" {
		return nil, errors.New("thread body must be a TipTap doc")
	}
	var assign any
	if assignmentStructureItemID != nil {
		assign = *assignmentStructureItemID
	} else {
		assign = nil
	}
	var d ThreadDetail
	var assignOut *uuid.UUID
	var bodyOut []byte
	err := pool.QueryRow(ctx, `
INSERT INTO course.discussion_threads (
  forum_id, assignment_structure_item_id, author_id, title, body, require_post_first
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, forum_id, assignment_structure_item_id, author_id, title, body,
  is_pinned, is_locked, require_post_first, created_at, updated_at
`, forumID, assign, authorID, title, body, requirePostFirst).Scan(
		&d.ID, &d.ForumID, &assignOut, &d.AuthorID, &d.Title, &bodyOut,
		&d.IsPinned, &d.IsLocked, &d.RequirePostFirst, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	d.AssignmentStructureItemID = assignOut
	d.Body = json.RawMessage(bodyOut)
	d.ReplyCount = 0
	return &d, nil
}

// AssignmentBelongsToCourse returns true when the structure item is an assignment in the course.
func AssignmentBelongsToCourse(ctx context.Context, pool *pgxpool.Pool, courseID, structureItemID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM course.module_assignments ma
  INNER JOIN course.course_structure_items c ON c.id = ma.structure_item_id
  WHERE ma.structure_item_id = $1 AND c.course_id = $2 AND c.kind = 'assignment'
)
`, structureItemID, courseID).Scan(&ok)
	return ok, err
}

// PatchThread updates instructor-controlled fields.
func PatchThread(ctx context.Context, pool *pgxpool.Pool, threadID uuid.UUID, isPinned, isLocked *bool, title *string) (*ThreadDetail, error) {
	if isPinned == nil && isLocked == nil && title == nil {
		return nil, errors.New("no patch fields")
	}
	// Load forum_id + course_id for return scan
	var courseID uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT f.course_id FROM course.discussion_threads t
INNER JOIN course.discussion_forums f ON f.id = t.forum_id
WHERE t.id = $1
`, threadID).Scan(&courseID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	sets := []string{"updated_at = NOW()"}
	args := []any{threadID}
	argi := 2
	if isPinned != nil {
		sets = append(sets, "is_pinned = $"+strconv.Itoa(argi))
		args = append(args, *isPinned)
		argi++
	}
	if isLocked != nil {
		sets = append(sets, "is_locked = $"+strconv.Itoa(argi))
		args = append(args, *isLocked)
		argi++
	}
	if title != nil {
		t := strings.TrimSpace(*title)
		if t == "" {
			return nil, errors.New("empty title")
		}
		sets = append(sets, "title = $"+strconv.Itoa(argi))
		args = append(args, t)
		argi++
	}
	q := `UPDATE course.discussion_threads SET ` + strings.Join(sets, ", ") + ` WHERE id = $1`
	ct, err := pool.Exec(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, nil
	}
	return GetThread(ctx, pool, courseID, threadID)
}

// StudentHasRootPost is true when the user authored a top-level post in the thread.
func StudentHasRootPost(ctx context.Context, pool *pgxpool.Pool, threadID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM course.discussion_posts
  WHERE thread_id = $1 AND author_id = $2 AND parent_post_id IS NULL
)
`, threadID, userID).Scan(&ok)
	return ok, err
}

// ParentPostDepth returns the nesting depth of postID (0 = top-level under the thread).
func ParentPostDepth(ctx context.Context, pool *pgxpool.Pool, postID uuid.UUID) (int, error) {
	depth := 0
	cur := postID
	for range 8 {
		var parent *uuid.UUID
		err := pool.QueryRow(ctx, `
SELECT parent_post_id FROM course.discussion_posts WHERE id = $1
`, cur).Scan(&parent)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, errors.New("parent not found")
			}
			return 0, err
		}
		if parent == nil {
			return depth, nil
		}
		depth++
		cur = *parent
	}
	return depth, errors.New("post depth too deep")
}

// ListPosts returns posts in thread order for display (flat list; client nests by parent_post_id).
func ListPosts(ctx context.Context, pool *pgxpool.Pool, threadID, viewerID uuid.UUID, staff, hidePeers bool, afterCreatedAt *time.Time, afterID *uuid.UUID, limit int) ([]PostRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	cursorClause := ""
	args := []any{threadID, viewerID, limit}
	if afterCreatedAt != nil && afterID != nil {
		cursorClause = `AND (p.created_at, p.id) > ($4::timestamptz, $5::uuid)`
		args = []any{threadID, viewerID, limit, *afterCreatedAt, *afterID}
	}
	q := `
SELECT p.id, p.thread_id, p.parent_post_id, p.author_id, p.body, p.upvote_count, p.created_at, p.updated_at,
       EXISTS(SELECT 1 FROM course.discussion_post_upvotes u WHERE u.post_id = p.id AND u.user_id = $2)
FROM course.discussion_posts p
WHERE p.thread_id = $1
`
	if hidePeers && !staff {
		q += ` AND p.author_id = $2`
	}
	q += cursorClause + `
ORDER BY p.created_at ASC, p.id ASC
LIMIT $3
`
	rows, err := pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PostRow
	for rows.Next() {
		var r PostRow
		var parent *uuid.UUID
		var body []byte
		if err := rows.Scan(&r.ID, &r.ThreadID, &parent, &r.AuthorID, &body, &r.UpvoteCount, &r.CreatedAt, &r.UpdatedAt, &r.ViewerUpvoted); err != nil {
			return nil, err
		}
		r.ParentPostID = parent
		r.Body = json.RawMessage(body)
		out = append(out, r)
	}
	return out, rows.Err()
}

// FindIdempotentPost returns an existing post id for the idempotency key, if any.
func FindIdempotentPost(ctx context.Context, q queryer, courseID, userID, threadID uuid.UUID, key string) (*uuid.UUID, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, nil
	}
	var pid uuid.UUID
	err := q.QueryRow(ctx, `
SELECT post_id FROM course.discussion_post_idempotency
WHERE course_id = $1 AND user_id = $2 AND thread_id = $3 AND idempotency_key = $4
`, courseID, userID, threadID, key).Scan(&pid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &pid, nil
}

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// CreatePost inserts a post; caller must run inside a transaction with courseID for idempotency + grades.
func CreatePost(ctx context.Context, tx pgx.Tx, courseID, threadID, authorID uuid.UUID, parentPostID *uuid.UUID, body json.RawMessage, idempotencyKey string) (*PostRow, error) {
	if !json.Valid(body) {
		return nil, errors.New("invalid post body json")
	}
	var root map[string]any
	if err := json.Unmarshal(body, &root); err != nil || root == nil {
		return nil, errors.New("invalid post body")
	}
	if ty, _ := root["type"].(string); ty != "doc" {
		return nil, errors.New("post body must be a TipTap doc")
	}
	var parent any
	if parentPostID != nil {
		parent = *parentPostID
	} else {
		parent = nil
	}
	var r PostRow
	var parentOut *uuid.UUID
	var bodyOut []byte
	err := tx.QueryRow(ctx, `
INSERT INTO course.discussion_posts (thread_id, parent_post_id, author_id, body)
VALUES ($1, $2, $3, $4)
RETURNING id, thread_id, parent_post_id, author_id, body, upvote_count, created_at, updated_at
`, threadID, parent, authorID, body).Scan(
		&r.ID, &r.ThreadID, &parentOut, &r.AuthorID, &bodyOut, &r.UpvoteCount, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	r.ParentPostID = parentOut
	r.Body = json.RawMessage(bodyOut)
	r.ViewerUpvoted = false
	key := strings.TrimSpace(idempotencyKey)
	if key != "" {
		if _, err := tx.Exec(ctx, `
INSERT INTO course.discussion_post_idempotency (course_id, user_id, thread_id, idempotency_key, post_id)
VALUES ($1, $2, $3, $4, $5)
`, courseID, authorID, threadID, key, r.ID); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE course.discussion_threads SET updated_at = NOW() WHERE id = $1`, threadID); err != nil {
		return nil, err
	}
	return &r, nil
}

// GetPost returns a post row if it exists in the course, with viewerUpvoted when viewer is non-nil.
func GetPost(ctx context.Context, pool *pgxpool.Pool, courseID, postID uuid.UUID, viewer *uuid.UUID) (*PostRow, error) {
	upvoteSel := `false`
	args := []any{postID, courseID}
	if viewer != nil {
		upvoteSel = `EXISTS(SELECT 1 FROM course.discussion_post_upvotes u WHERE u.post_id = p.id AND u.user_id = $3)`
		args = []any{postID, courseID, *viewer}
	}
	row := pool.QueryRow(ctx, `
SELECT p.id, p.thread_id, p.parent_post_id, p.author_id, p.body, p.upvote_count, p.created_at, p.updated_at,
       `+upvoteSel+`
FROM course.discussion_posts p
INNER JOIN course.discussion_threads t ON t.id = p.thread_id
INNER JOIN course.discussion_forums f ON f.id = t.forum_id
WHERE p.id = $1 AND f.course_id = $2
`, args...)
	var r PostRow
	var parent *uuid.UUID
	var body []byte
	if err := row.Scan(&r.ID, &r.ThreadID, &parent, &r.AuthorID, &body, &r.UpvoteCount, &r.CreatedAt, &r.UpdatedAt, &r.ViewerUpvoted); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	r.ParentPostID = parent
	r.Body = json.RawMessage(body)
	return &r, nil
}

// DeletePost removes a post (cascades to children via FK ... we used ON DELETE CASCADE on parent - children deleted).
func DeletePost(ctx context.Context, pool *pgxpool.Pool, postID uuid.UUID) error {
	_, err := pool.Exec(ctx, `DELETE FROM course.discussion_posts WHERE id = $1`, postID)
	return err
}

// Upvote toggles: inserts upvote and increments, or no-op if exists (returns wasAdded=false).
func Upvote(ctx context.Context, pool *pgxpool.Pool, postID, userID uuid.UUID) (wasAdded bool, newCount int, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var inserted int
	err = tx.QueryRow(ctx, `
WITH ins AS (
  INSERT INTO course.discussion_post_upvotes (post_id, user_id) VALUES ($1, $2)
  ON CONFLICT DO NOTHING
  RETURNING 1
)
SELECT COUNT(*)::int FROM ins
`, postID, userID).Scan(&inserted)
	if err != nil {
		return false, 0, err
	}
	if inserted > 0 {
		if _, err := tx.Exec(ctx, `UPDATE course.discussion_posts SET upvote_count = upvote_count + 1, updated_at = NOW() WHERE id = $1`, postID); err != nil {
			return false, 0, err
		}
	}
	var cnt int
	if err := tx.QueryRow(ctx, `SELECT upvote_count FROM course.discussion_posts WHERE id = $1`, postID).Scan(&cnt); err != nil {
		return false, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, 0, err
	}
	return inserted > 0, cnt, nil
}

// EnsureGradeForDiscussion creates a 0-point grade row when a graded thread receives a student's first root post.
func EnsureGradeForDiscussion(ctx context.Context, tx pgx.Tx, courseID, studentID, moduleItemID uuid.UUID) error {
	_, err := tx.Exec(ctx, `
INSERT INTO course.course_grades (course_id, student_user_id, module_item_id, points_earned, updated_at)
VALUES ($1, $2, $3, 0, NOW())
ON CONFLICT (student_user_id, module_item_id) DO NOTHING
`, courseID, studentID, moduleItemID)
	return err
}

// ThreadAssignment returns linked assignment structure item id for a graded thread, if any.
func ThreadAssignment(ctx context.Context, pool *pgxpool.Pool, threadID uuid.UUID) (*uuid.UUID, error) {
	var assign *uuid.UUID
	err := pool.QueryRow(ctx, `SELECT assignment_structure_item_id FROM course.discussion_threads WHERE id = $1`, threadID).Scan(&assign)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return assign, nil
}

// ParentPostThread validates parent belongs to same thread.
func ParentPostThread(ctx context.Context, pool *pgxpool.Pool, threadID, parentPostID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS(SELECT 1 FROM course.discussion_posts WHERE id = $1 AND thread_id = $2)
`, parentPostID, threadID).Scan(&ok)
	return ok, err
}
