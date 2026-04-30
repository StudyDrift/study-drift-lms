// Per-user highlights/notes on the course syllabus (course.syllabus_user_markups).
package syllabusmarkups

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Markup matches the content-page reader JSON (camelCase in HTTP layer).
type Markup struct {
	ID              uuid.UUID
	Kind            string
	QuoteText       string
	NotebookPageID  *string
	CommentText     *string
	CreatedAt       time.Time
}

// ListForUserCourse returns a user's markups in a course.
func ListForUserCourse(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID) ([]Markup, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	rows, err := pool.Query(ctx, `
SELECT id, kind, quote_text, notebook_page_id, comment_text, created_at
FROM course.syllabus_user_markups
WHERE user_id = $1 AND course_id = $2
ORDER BY created_at ASC
`, userID, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Markup
	for rows.Next() {
		var m Markup
		if err := rows.Scan(&m.ID, &m.Kind, &m.QuoteText, &m.NotebookPageID, &m.CommentText, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		out = []Markup{}
	}
	return out, nil
}

// Insert creates a row and returns the stored values.
func Insert(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID, kind, quoteText string, notebookPageID, commentText *string) (*Markup, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var m Markup
	err := pool.QueryRow(ctx, `
INSERT INTO course.syllabus_user_markups
	(user_id, course_id, kind, quote_text, notebook_page_id, comment_text)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, kind, quote_text, notebook_page_id, comment_text, created_at
`, userID, courseID, kind, quoteText, notebookPageID, commentText).Scan(
		&m.ID, &m.Kind, &m.QuoteText, &m.NotebookPageID, &m.CommentText, &m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// DeleteOwned deletes by id if it belongs to the user and course. Returns true if a row was removed.
func DeleteOwned(ctx context.Context, pool *pgxpool.Pool, userID, courseID, markupID uuid.UUID) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	ct, err := pool.Exec(ctx, `
DELETE FROM course.syllabus_user_markups
WHERE id = $1 AND user_id = $2 AND course_id = $3
`, markupID, userID, courseID)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() > 0, nil
}
