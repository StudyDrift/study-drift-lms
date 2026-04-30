// Package communication holds JSON shapes for the mailbox API (server/src/models/communication.rs).
package communication

import (
	"time"

	"github.com/google/uuid"
)

// Party is a mailbox participant (name + email for display).
type Party struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// MailboxMessage is a single message view for the authenticated user's folder.
type MailboxMessage struct {
	ID            uuid.UUID `json:"id"`
	From          Party     `json:"from"`
	To            string    `json:"to"`
	Subject       string    `json:"subject"`
	Snippet       string    `json:"snippet"`
	Body          string    `json:"body"`
	SentAt        time.Time `json:"sentAt"`
	Read          bool      `json:"read"`
	Starred       bool      `json:"starred"`
	Folder        string    `json:"folder"`
	HasAttachment bool      `json:"hasAttachment"`
}

// MailboxListResponse is returned by GET /api/v1/communication/messages?folder=...
type MailboxListResponse struct {
	Messages []MailboxMessage `json:"messages"`
}

// UnreadCountResponse is returned by GET /api/v1/communication/unread-count
type UnreadCountResponse struct {
	UnreadInbox int64 `json:"unreadInbox"`
}

// SendMessageRequest is the body for POST (send or draft).
type SendMessageRequest struct {
	ToEmail *string `json:"toEmail"`
	Subject string  `json:"subject"`
	Body    string  `json:"body"`
	Draft   bool    `json:"draft"`
}

// PatchMailboxRequest patches read/starred/folder for a mailbox entry.
type PatchMailboxRequest struct {
	Read    *bool   `json:"read"`
	Starred *bool   `json:"starred"`
	Folder  *string `json:"folder"`
}

// SendMessageResponse returns the new message id after send or save draft.
type SendMessageResponse struct {
	ID uuid.UUID `json:"id"`
}
