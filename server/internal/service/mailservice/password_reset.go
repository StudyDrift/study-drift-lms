// Password reset delivery (Rust `server/src/services/mail.rs`); implementation lives in internal/mail.
package mailservice

import (
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/mail"
)

// SendPasswordResetEmail sends via SMTP when configured; no-ops with a log line when SMTP_HOST is unset.
func SendPasswordResetEmail(c config.Config, toEmail, resetURL string, opts *mail.PasswordResetOpts) error {
	return mail.SendPasswordResetEmail(c, toEmail, resetURL, opts)
}
