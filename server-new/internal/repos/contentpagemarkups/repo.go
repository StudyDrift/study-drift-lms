package contentpagemarkups

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/models/contentpagemarkups"
)

const (
	MaxQuoteLen          = 24000
	MaxCommentLen        = 8000
	MaxNotebookPageIDLen = 128
)

func ValidateMarkupRequest(kind, quoteText string, notebookPageID, commentText *string) error {
	if quoteText == "" {
		return errors.New("quoteText must not be empty")
	}
	if len(quoteText) > MaxQuoteLen {
		return errors.New("quoteText is too long")
	}
	if commentText != nil && len(*commentText) > MaxCommentLen {
		return errors.New("commentText is too long")
	}
	if notebookPageID != nil && len(*notebookPageID) > MaxNotebookPageIDLen {
		return errors.New("notebookPageId is too long")
	}
	switch kind {
	case "highlight":
		if notebookPageID != nil || commentText != nil {
			return errors.New("highlight must not include notebookPageId or commentText")
		}
	case "note":
		if notebookPageID == nil || *notebookPageID == "" {
			return errors.New("note requires notebookPageId")
		}
	default:
		return errors.New("kind must be highlight or note")
	}
	return nil
}

type dbtx interface {
	Query(context.Context, string, ...any) (rows pgxRows, err error)
	QueryRow(context.Context, string, ...any) pgxRow
	Exec(context.Context, string, ...any) (pgxTag, error)
}

type pgxRows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
	Err() error
}

type pgxRow interface {
	Scan(dest ...any) error
}

type pgxTag interface {
	RowsAffected() int64
}

func ListForUserItem(ctx context.Context, q dbtx, userID, courseID, structureItemID uuid.UUID) ([]contentpagemarkups.ContentPageMarkupResponse, error) {
	rows, err := q.Query(ctx, `
SELECT id, kind, quote_text, notebook_page_id, comment_text, created_at
FROM course.content_page_user_markups
WHERE user_id = $1 AND course_id = $2 AND structure_item_id = $3
ORDER BY created_at ASC
`, userID, courseID, structureItemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]contentpagemarkups.ContentPageMarkupResponse, 0)
	for rows.Next() {
		var r contentpagemarkups.ContentPageMarkupResponse
		if err := rows.Scan(&r.ID, &r.Kind, &r.QuoteText, &r.NotebookPageID, &r.CommentText, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func Insert(ctx context.Context, q dbtx, userID, courseID, structureItemID uuid.UUID, structureKind, kind, quoteText string, notebookPageID, commentText *string) (*contentpagemarkups.ContentPageMarkupResponse, error) {
	var r contentpagemarkups.ContentPageMarkupResponse
	err := q.QueryRow(ctx, `
INSERT INTO course.content_page_user_markups (
	user_id, course_id, structure_item_id, kind, quote_text, notebook_page_id, comment_text
)
SELECT $1, $2, $3, $4, $5, $6, $7
FROM course.course_structure_items si
WHERE si.id = $3 AND si.course_id = $2 AND si.kind = $8
RETURNING id, kind, quote_text, notebook_page_id, comment_text, created_at
`, userID, courseID, structureItemID, kind, quoteText, notebookPageID, commentText, structureKind).Scan(
		&r.ID, &r.Kind, &r.QuoteText, &r.NotebookPageID, &r.CommentText, &r.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func DeleteOwned(ctx context.Context, q dbtx, userID, courseID, structureItemID, markupID uuid.UUID) (bool, error) {
	tag, err := q.Exec(ctx, `
DELETE FROM course.content_page_user_markups
WHERE id = $1 AND user_id = $2 AND course_id = $3 AND structure_item_id = $4
`, markupID, userID, courseID, structureItemID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
