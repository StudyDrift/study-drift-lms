package mail

import (
	"errors"
	"fmt"
	"log"
	"net/mail"
	"net/smtp"
	"strings"

	"github.com/lextures/lextures/server/internal/config"
)

var (
	ErrInvalidToEmail = errors.New("invalid to email address")
)

// PasswordResetOpts carries optional org branding for transactional email (plan 5.7).
type PasswordResetOpts struct {
	FromDisplayName *string
	LogoURL         *string
	PrimaryColor    string
}

func absPublicURL(cfg config.Config, pathOrURL string) string {
	s := strings.TrimSpace(pathOrURL)
	if s == "" {
		return ""
	}
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		return s
	}
	base := strings.TrimRight(strings.TrimSpace(cfg.LTIAPIBaseURL), "/")
	if !strings.HasPrefix(s, "/") {
		s = "/" + s
	}
	return base + s
}

// SendPasswordResetEmail sends a reset link when SMTP is configured; if SMTP_HOST is empty, logs the URL and returns nil (Rust parity).
func SendPasswordResetEmail(c config.Config, toEmail, resetURL string, opts *PasswordResetOpts) error {
	if len(toEmail) == 0 {
		return ErrInvalidToEmail
	}

	host := strings.TrimSpace(c.SMTPHost)
	if host == "" {
		log.Printf("mail: password reset for %q (SMTP not configured; set Global platform email or SMTP_HOST) url=%q", toEmail, resetURL)
		return nil
	}
	from := strings.TrimSpace(c.SMTPFrom)
	if from == "" {
		return fmt.Errorf("SMTP_FROM is required when SMTP_HOST is set")
	}

	fromAddr, err := mail.ParseAddress(from)
	if err != nil {
		return fmt.Errorf("parse SMTP_FROM: %w", err)
	}
	if opts != nil && opts.FromDisplayName != nil && strings.TrimSpace(*opts.FromDisplayName) != "" {
		fromAddr.Name = strings.TrimSpace(*opts.FromDisplayName)
	}

	subject := "Reset your StudyDrift password"
	bodyText := fmt.Sprintf(`You requested a password reset for your StudyDrift account.

Open this link to choose a new password (it expires in one hour):

%s

If you did not request this, you can ignore this message.
`, resetURL)

	logoURL := ""
	if opts != nil && opts.LogoURL != nil {
		logoURL = absPublicURL(c, *opts.LogoURL)
	}
	color := "#4F46E5"
	if opts != nil && strings.TrimSpace(opts.PrimaryColor) != "" {
		color = strings.TrimSpace(opts.PrimaryColor)
	}

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111827;">
%s
<p>You requested a password reset for your StudyDrift account.</p>
<p><a href="%s" style="color:%s;font-weight:600;">Choose a new password</a> (expires in one hour).</p>
<p style="font-size:13px;color:#6b7280;">If you did not request this, you can ignore this message.</p>
</body></html>`,
		func() string {
			if logoURL == "" {
				return ""
			}
			return fmt.Sprintf(`<div style="margin-bottom:16px;"><img src="%s" alt="" width="180" style="max-width:100%%;height:auto;" /></div>`, logoURL)
		}(),
		resetURL,
		color,
	)

	boundary := "lextures-boundary-7bit"
	msg := []string{
		"To: " + toEmail,
		"From: " + fromAddr.String(),
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: multipart/alternative; boundary=" + boundary,
		"",
		"--" + boundary,
		"Content-Type: text/plain; charset=utf-8",
		"",
		bodyText,
		"",
		"--" + boundary,
		"Content-Type: text/html; charset=utf-8",
		"",
		htmlBody,
		"",
		"--" + boundary + "--",
	}
	data := []byte(strings.Join(msg, "\r\n"))

	addr := fmt.Sprintf("%s:%d", host, c.SMTPPort)
	if c.SMTPUser != "" && c.SMTPPassword != "" {
		auth := smtp.PlainAuth("", c.SMTPUser, c.SMTPPassword, host)
		return smtp.SendMail(addr, auth, fromAddr.Address, []string{toEmail}, data)
	}
	return smtp.SendMail(addr, nil, fromAddr.Address, []string{toEmail}, data)
}
