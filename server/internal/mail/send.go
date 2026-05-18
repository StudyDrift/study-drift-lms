package mail

import (
	"fmt"
	"log"
	"net/mail"
	"net/smtp"
	"strings"

	"github.com/lextures/lextures/server/internal/config"
)

// BrandingOpts carries optional org branding for transactional email (plan 5.7).
type BrandingOpts struct {
	FromDisplayName *string
	LogoURL         *string
	PrimaryColor    string
}

// SendMultipart sends a multipart alternative email (plain + HTML).
func SendMultipart(c config.Config, toEmail, subject, bodyText, htmlBody string, branding *BrandingOpts) error {
	if len(strings.TrimSpace(toEmail)) == 0 {
		return ErrInvalidToEmail
	}
	host := strings.TrimSpace(c.SMTPHost)
	if host == "" {
		log.Printf("mail: would send to %q subject=%q (SMTP not configured)", toEmail, subject)
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
	if branding != nil && branding.FromDisplayName != nil && strings.TrimSpace(*branding.FromDisplayName) != "" {
		fromAddr.Name = strings.TrimSpace(*branding.FromDisplayName)
	}

	color := "#4F46E5"
	logoURL := ""
	if branding != nil {
		if strings.TrimSpace(branding.PrimaryColor) != "" {
			color = strings.TrimSpace(branding.PrimaryColor)
		}
		if branding.LogoURL != nil {
			logoURL = absPublicURL(c, *branding.LogoURL)
		}
	}
	if htmlBody == "" {
		htmlBody = plainToSimpleHTML(bodyText, logoURL, color)
	}

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

func plainToSimpleHTML(bodyText, logoURL, _ string) string {
	escaped := strings.ReplaceAll(bodyText, "&", "&amp;")
	escaped = strings.ReplaceAll(escaped, "<", "&lt;")
	escaped = strings.ReplaceAll(escaped, "\n", "<br/>\n")
	logo := ""
	if logoURL != "" {
		logo = fmt.Sprintf(`<div style="margin-bottom:16px;"><img src="%s" alt="" width="180" style="max-width:100%%;height:auto;" /></div>`, logoURL)
	}
	return fmt.Sprintf(`<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111827;font-size:14px;">
%s
<p style="color:#374151;">%s</p>
</body></html>`, logo, escaped)
}
