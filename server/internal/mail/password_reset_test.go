package mail

import (
	"testing"

	"github.com/lextures/lextures/server/internal/config"
)

func TestSendPasswordResetEmail_NoSMTP(t *testing.T) {
	t.Parallel()
	// no panic; logs only when SMTP is unset
	c := config.Config{}
	if err := SendPasswordResetEmail(c, "a@b.com", "http://x/y", nil); err != nil {
		t.Fatal(err)
	}
}

func TestSendPasswordResetEmail_NoToEmail(t *testing.T) {
	t.Parallel()
	c := config.Config{}
	if err := SendPasswordResetEmail(c, "", "http://x/y", nil); err == nil {
		t.Fatal("Expected fatal error for invalid email address")
	}
}
