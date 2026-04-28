// Mailbox queries and mutators (server/src/repos/communication.rs).
package communication

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	models "github.com/lextures/lextures/server-new/internal/models/communication"
	"github.com/lextures/lextures/server-new/internal/repos/user"
)

const userTable = `"user".users`

type listRow struct {
	MessageID         uuid.UUID
	Subject, Body     string
	Snippet             string
	HasAttachment     bool
	CreatedAt         time.Time
	Folder            string
	ReadAt            *time.Time
	Starred           bool
	SenderEmail       string
	SenderDisplayName *string
	RecipientEmail    *string
}

func rowToMessage(row listRow) models.MailboxMessage {
	sname := row.SenderEmail
	if row.SenderDisplayName != nil && strings.TrimSpace(*row.SenderDisplayName) != "" {
		sname = *row.SenderDisplayName
	}
	to := ""
	if row.RecipientEmail != nil {
		to = *row.RecipientEmail
	}
	read := true
	if row.Folder == "inbox" {
		read = row.ReadAt != nil
	}
	return models.MailboxMessage{
		ID: row.MessageID,
		From: models.Party{
			Name:  sname,
			Email: row.SenderEmail,
		},
		To:            to,
		Subject:       row.Subject,
		Snippet:       row.Snippet,
		Body:          row.Body,
		SentAt:        row.CreatedAt,
		Read:          read,
		Starred:       row.Starred,
		Folder:        row.Folder,
		HasAttachment: row.HasAttachment,
	}
}

// ListForUser returns messages for a folder, optionally filtered by a search string (see Rust ILIKE).
func ListForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, folder, q string) ([]models.MailboxMessage, error) {
	pattern := strings.TrimSpace(q)
	if pattern == "" {
		return listForUserNoSearch(ctx, pool, userID, folder)
	}
	like := "%" + pattern + "%"
	rows, err := pool.Query(ctx, fmt.Sprintf(`
SELECT
  m.id AS message_id,
  m.subject, m.body, m.snippet, m.has_attachment, m.created_at,
  mb.folder, mb.read_at, mb.starred,
  sender.email AS sender_email, sender.display_name AS sender_display_name,
  recipient.email AS recipient_email
FROM communication.mailbox_entries mb
INNER JOIN communication.messages m ON m.id = mb.message_id
INNER JOIN %s sender ON sender.id = m.sender_user_id
LEFT JOIN %s recipient ON recipient.id = m.recipient_user_id
WHERE mb.user_id = $1
  AND (
    ($2 = 'starred' AND mb.starred = TRUE AND mb.folder <> 'trash')
    OR ($2 <> 'starred' AND mb.folder = $2)
  )
  AND (
    m.subject ILIKE $3 OR m.body ILIKE $3 OR sender.email ILIKE $3
    OR COALESCE(recipient.email, '') ILIKE $3
  )
ORDER BY m.created_at DESC
`, userTable, userTable), userID, folder, like)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanListRows(rows)
}

func listForUserNoSearch(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, folder string) ([]models.MailboxMessage, error) {
	rows, err := pool.Query(ctx, fmt.Sprintf(`
SELECT
  m.id AS message_id,
  m.subject, m.body, m.snippet, m.has_attachment, m.created_at,
  mb.folder, mb.read_at, mb.starred,
  sender.email AS sender_email, sender.display_name AS sender_display_name,
  recipient.email AS recipient_email
FROM communication.mailbox_entries mb
INNER JOIN communication.messages m ON m.id = mb.message_id
INNER JOIN %s sender ON sender.id = m.sender_user_id
LEFT JOIN %s recipient ON recipient.id = m.recipient_user_id
WHERE mb.user_id = $1
  AND (
    ($2 = 'starred' AND mb.starred = TRUE AND mb.folder <> 'trash')
    OR ($2 <> 'starred' AND mb.folder = $2)
  )
ORDER BY m.created_at DESC
`, userTable, userTable), userID, folder)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanListRows(rows)
}

func scanListRows(rows pgx.Rows) ([]models.MailboxMessage, error) {
	var out []models.MailboxMessage
	for rows.Next() {
		var r listRow
		var displayName, recipientEmail sql.NullString
		if err := rows.Scan(
			&r.MessageID, &r.Subject, &r.Body, &r.Snippet, &r.HasAttachment, &r.CreatedAt,
			&r.Folder, &r.ReadAt, &r.Starred,
			&r.SenderEmail, &displayName, &recipientEmail,
		); err != nil {
			return nil, err
		}
		if displayName.Valid {
			s := displayName.String
			r.SenderDisplayName = &s
		}
		if recipientEmail.Valid {
			s := recipientEmail.String
			r.RecipientEmail = &s
		}
		out = append(out, rowToMessage(r))
	}
	return out, rows.Err()
}

// GetForUser returns one message the user can see, or nil.
func GetForUser(ctx context.Context, pool *pgxpool.Pool, userID, messageID uuid.UUID) (*models.MailboxMessage, error) {
	var r listRow
	var displayName, recipientEmail sql.NullString
	err := pool.QueryRow(ctx, fmt.Sprintf(`
SELECT
  m.id AS message_id,
  m.subject, m.body, m.snippet, m.has_attachment, m.created_at,
  mb.folder, mb.read_at, mb.starred,
  sender.email AS sender_email, sender.display_name AS sender_display_name,
  recipient.email AS recipient_email
FROM communication.mailbox_entries mb
INNER JOIN communication.messages m ON m.id = mb.message_id
INNER JOIN %s sender ON sender.id = m.sender_user_id
LEFT JOIN %s recipient ON recipient.id = m.recipient_user_id
WHERE mb.user_id = $1 AND m.id = $2
`, userTable, userTable), userID, messageID).Scan(
		&r.MessageID, &r.Subject, &r.Body, &r.Snippet, &r.HasAttachment, &r.CreatedAt,
		&r.Folder, &r.ReadAt, &r.Starred,
		&r.SenderEmail, &displayName, &recipientEmail,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if displayName.Valid {
		s := displayName.String
		r.SenderDisplayName = &s
	}
	if recipientEmail.Valid {
		s := recipientEmail.String
		r.RecipientEmail = &s
	}
	m := rowToMessage(r)
	return &m, nil
}

// CountUnreadInbox returns unread messages in the inbox folder.
func CountUnreadInbox(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint
FROM communication.mailbox_entries mb
WHERE mb.user_id = $1
  AND mb.folder = 'inbox'
  AND mb.read_at IS NULL
`, userID).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}

// SendMessage inserts a sent message; returns (nil, nil) if the recipient email is not registered.
func SendMessage(ctx context.Context, pool *pgxpool.Pool, senderID uuid.UUID, toEmail, subject, body string) (*uuid.UUID, error) {
	toEmail = strings.TrimSpace(toEmail)
	row, err := user.FindByEmail(ctx, pool, user.NormalizeEmail(toEmail))
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	recipientID, err := uuid.Parse(row.ID)
	if err != nil {
		return nil, err
	}
	snippet := MakeSnippet(body)

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var messageID uuid.UUID
	err = tx.QueryRow(ctx, `
INSERT INTO communication.messages
  (sender_user_id, recipient_user_id, subject, body, snippet, has_attachment)
VALUES ($1::uuid, $2::uuid, $3, $4, $5, FALSE)
RETURNING id
`, senderID, recipientID, subject, body, snippet).Scan(&messageID)
	if err != nil {
		return nil, err
	}

	if senderID == recipientID {
		_, err = tx.Exec(ctx, `
INSERT INTO communication.mailbox_entries
  (user_id, message_id, folder, read_at, starred)
VALUES ($1::uuid, $2::uuid, 'inbox', NULL, FALSE)
`, senderID, messageID)
	} else {
		_, err = tx.Exec(ctx, `
INSERT INTO communication.mailbox_entries
  (user_id, message_id, folder, read_at, starred)
VALUES ($1::uuid, $2::uuid, 'sent', NOW(), FALSE)
`, senderID, messageID)
		if err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `
INSERT INTO communication.mailbox_entries
  (user_id, message_id, folder, read_at, starred)
VALUES ($1::uuid, $2::uuid, 'inbox', NULL, FALSE)
`, recipientID, messageID)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &messageID, nil
}

// SaveDraft creates a draft message in the sender's drafts folder.
func SaveDraft(ctx context.Context, pool *pgxpool.Pool, senderID uuid.UUID, subject, body string) (uuid.UUID, error) {
	snippet := MakeSnippet(body)
	tx, err := pool.Begin(ctx)
	if err != nil {
		return uuid.UUID{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var messageID uuid.UUID
	err = tx.QueryRow(ctx, `
INSERT INTO communication.messages
  (sender_user_id, recipient_user_id, subject, body, snippet, has_attachment)
VALUES ($1::uuid, NULL, $2, $3, $4, FALSE)
RETURNING id
`, senderID, subject, body, snippet).Scan(&messageID)
	if err != nil {
		return uuid.UUID{}, err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO communication.mailbox_entries
  (user_id, message_id, folder, read_at, starred)
VALUES ($1::uuid, $2::uuid, 'drafts', NOW(), FALSE)
`, senderID, messageID)
	if err != nil {
		return uuid.UUID{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.UUID{}, err
	}
	return messageID, nil
}

// UpdateMailbox applies patch fields to the user's row for a message. Returns false if the row is missing.
func UpdateMailbox(ctx context.Context, pool *pgxpool.Pool, userID, messageID uuid.UUID, req *models.PatchMailboxRequest) (bool, error) {
	var dummy uuid.UUID
	err := pool.QueryRow(ctx,
		`SELECT message_id::uuid FROM communication.mailbox_entries WHERE user_id = $1::uuid AND message_id = $2::uuid`,
		userID, messageID,
	).Scan(&dummy)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if req.Read != nil {
		if *req.Read {
			_, err = pool.Exec(ctx, `
UPDATE communication.mailbox_entries
SET read_at = NOW()
WHERE user_id = $1::uuid AND message_id = $2::uuid AND read_at IS NULL
`, userID, messageID)
		} else {
			_, err = pool.Exec(ctx, `
UPDATE communication.mailbox_entries
SET read_at = NULL
WHERE user_id = $1::uuid AND message_id = $2::uuid
`, userID, messageID)
		}
		if err != nil {
			return false, err
		}
	}
	if req.Starred != nil {
		_, err = pool.Exec(ctx, `
UPDATE communication.mailbox_entries
SET starred = $3
WHERE user_id = $1::uuid AND message_id = $2::uuid
`, userID, messageID, *req.Starred)
		if err != nil {
			return false, err
		}
	}
	if req.Folder != nil {
		f := *req.Folder
		if f != "inbox" && f != "sent" && f != "drafts" && f != "trash" {
			return false, nil
		}
		res, err := pool.Exec(ctx, `
UPDATE communication.mailbox_entries
SET folder = $3
WHERE user_id = $1::uuid AND message_id = $2::uuid
`, userID, messageID, f)
		if err != nil {
			return false, err
		}
		if res.RowsAffected() == 0 {
			return false, nil
		}
	}
	return true, nil
}
