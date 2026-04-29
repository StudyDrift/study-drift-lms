// Package mail is a small SMTP helper mirroring server/src/services/mail.rs.
package mail

import (
	"fmt"
	"log"
	"net/smtp"
	"strings"
	"errors"

	"github.com/lextures/lextures/server-new/internal/config"
)

var (
	ErrInvalidToEmail = errors.New("invalid to email address")
)

// SendPasswordResetEmail sends a reset link when SMTP is configured; if SMTP_HOST is empty, logs the URL and returns nil (Rust parity).
func SendPasswordResetEmail(c config.Config, toEmail, resetURL string) error {
	if len(toEmail) == 0 {
		return ErrInvalidToEmail
	}

	host := strings.TrimSpace(c.SMTPHost)
	if host == "" {
		log.Printf("mail: password reset for %q (SMTP not configured; set SMTP_HOST to send email) url=%q", toEmail, resetURL)
		return nil
	}
	from := strings.TrimSpace(c.SMTPFrom)
	if from == "" {
		return fmt.Errorf("SMTP_FROM is required when SMTP_HOST is set")
	}
	body := fmt.Sprintf(`You requested a password reset for your StudyDrift account.

Open this link to choose a new password (it expires in one hour):

%s

If you did not request this, you can ignore this message.
`, resetURL)
	msg := []string{
		"To: " + toEmail,
		"From: " + from,
		"Subject: Reset your StudyDrift password",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		body,
	}
	data := []byte(strings.Join(msg, "\r\n"))

	addr := fmt.Sprintf("%s:%d", host, c.SMTPPort)
	if c.SMTPUser != "" && c.SMTPPassword != "" {
		auth := smtp.PlainAuth("", c.SMTPUser, c.SMTPPassword, host)
		return smtp.SendMail(addr, auth, from, []string{toEmail}, data)
	}
	return smtp.SendMail(addr, nil, from, []string{toEmail}, data)
}
