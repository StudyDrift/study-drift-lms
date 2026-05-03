package mail

import (
	"errors"
	"fmt"
	"log"
	"net/smtp"
	"strings"

	"github.com/lextures/lextures/server/internal/config"
)

// SendMagicLinkEmail sends a one-time login link when SMTP is configured; otherwise logs the URL (parity with password reset).
func SendMagicLinkEmail(c config.Config, toEmail, magicURL string) error {
	if len(toEmail) == 0 {
		return ErrInvalidToEmail
	}
	host := strings.TrimSpace(c.SMTPHost)
	if host == "" {
		log.Printf("mail: magic link for %q (SMTP not configured; set SMTP_HOST to send email) url=%q", toEmail, magicURL)
		return nil
	}
	from := strings.TrimSpace(c.SMTPFrom)
	if from == "" {
		return errors.New("SMTP_FROM is required when SMTP_HOST is set")
	}
	body := fmt.Sprintf(`Sign in to your StudyDrift account without a password.

Open this link within 15 minutes (it works only once):

%s

If you did not request this, you can ignore this message.
`, magicURL)
	msg := []string{
		"To: " + toEmail,
		"From: " + from,
		"Subject: Your StudyDrift sign-in link",
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
