package mail

import (
	"testing"

	"github.com/lextures/lextures/server/internal/config"
)

func TestSendPasswordReset_NoSMTP(t *testing.T) {
	if err := SendPasswordResetEmail(config.Config{}, "u@example.com", "http://x"); err != nil {
		t.Fatal(err)
	}
}

func TestSendPasswordReset_NoToEmail(t *testing.T) {
	if err := SendPasswordResetEmail(config.Config{}, "", "http://x"); err == nil {
		t.Fatal("expected error")
	}
}

func TestSendPasswordReset_MissingFrom(t *testing.T) {
	c := config.Config{SMTPHost: "localhost", SMTPPort: uint16(1234)}
	if err := SendPasswordResetEmail(c, "u@x.com", "http://x"); err == nil {
		t.Fatal("expected error")
	}
}

func TestSendPasswordReset_HostUnreachable_NoAuth(t *testing.T) {
	// 127.0.0.1:1 is reserved/unused — Dial fails immediately, exercising the no-auth branch.
	c := config.Config{SMTPHost: "127.0.0.1", SMTPPort: uint16(1), SMTPFrom: "from@x.com"}
	if err := SendPasswordResetEmail(c, "to@x.com", "http://link"); err == nil {
		t.Fatal("expected dial error")
	}
}

func TestSendPasswordReset_HostUnreachable_WithAuth(t *testing.T) {
	c := config.Config{SMTPHost: "127.0.0.1", SMTPPort: uint16(1), SMTPFrom: "from@x.com", SMTPUser: "u", SMTPPassword: "p"}
	if err := SendPasswordResetEmail(c, "to@x.com", "http://link"); err == nil {
		t.Fatal("expected dial error")
	}
}

func TestSendMagicLink_MissingFrom(t *testing.T) {
	c := config.Config{SMTPHost: "localhost", SMTPPort: uint16(1234)}
	if err := SendMagicLinkEmail(c, "u@x.com", "http://x"); err == nil {
		t.Fatal("expected error")
	}
}

func TestSendMagicLink_HostUnreachable_NoAuth(t *testing.T) {
	c := config.Config{SMTPHost: "127.0.0.1", SMTPPort: uint16(1), SMTPFrom: "from@x.com"}
	if err := SendMagicLinkEmail(c, "to@x.com", "http://link"); err == nil {
		t.Fatal("expected dial error")
	}
}

func TestSendMagicLink_HostUnreachable_WithAuth(t *testing.T) {
	c := config.Config{SMTPHost: "127.0.0.1", SMTPPort: uint16(1), SMTPFrom: "from@x.com", SMTPUser: "u", SMTPPassword: "p"}
	if err := SendMagicLinkEmail(c, "to@x.com", "http://link"); err == nil {
		t.Fatal("expected dial error")
	}
}
