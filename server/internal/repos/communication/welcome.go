// Package communication is a port of server/src/repos/communication.rs (subset + full mailbox in mailbox.go).
package communication

import (
	"context"
	"log"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PlatformInboxSenderID is migration 031_platform_inbox_sender.sql.
var PlatformInboxSenderID = uuid.MustParse("a0000000-0000-4000-8000-000000000001")

// SendWelcomeMessage enqueues a welcome message for a newly registered user (inbox; platform sender).
func SendWelcomeMessage(ctx context.Context, pool *pgxpool.Pool, recipientEmail string) {
	const subject = "Welcome to Lextures"
	const body = `We're glad you're here.

Your inbox is where you'll receive messages from instructors and updates about your courses. Explore the platform—we're happy to have you.

— The Lextures team`
	id, err := SendMessage(ctx, pool, PlatformInboxSenderID, recipientEmail, subject, body)
	if err != nil {
		log.Printf("communication: welcome message: %v", err)
		return
	}
	if id == nil {
		log.Printf("communication: welcome message skipped: recipient %q not found", recipientEmail)
	}
}
