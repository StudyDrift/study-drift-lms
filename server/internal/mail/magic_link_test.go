package mail

import (
	"testing"

	"github.com/lextures/lextures/server/internal/config"
)

func TestSendMagicLinkEmail_NoSMTP(t *testing.T) {
	c := config.Config{}
	if err := SendMagicLinkEmail(c, "a@b.com", "http://x/y"); err != nil {
		t.Fatal(err)
	}
}

func TestSendMagicLinkEmail_NoToEmail(t *testing.T) {
	c := config.Config{}
	if err := SendMagicLinkEmail(c, "", "http://x/y"); err == nil {
		t.Fatal("expected error")
	}
}
