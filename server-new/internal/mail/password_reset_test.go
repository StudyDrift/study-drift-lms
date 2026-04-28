package mail

import (
	"testing"

	"github.com/lextures/lextures/server-new/internal/config"
)

func TestSendPasswordResetEmail_NoSMTP(t *testing.T) {
	t.Parallel()
	// no panic; logs only when SMTP is unset
	c := config.Config{}
	if err := SendPasswordResetEmail(c, "a@b.com", "http://x/y"); err != nil {
		t.Fatal(err)
	}
}
