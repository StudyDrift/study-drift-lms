package notifications

import (
	"testing"

	"github.com/google/uuid"
)

func TestUnsubscribeTokenRoundTrip(t *testing.T) {
	secret := "test-secret-at-least-32-characters-long"
	userID := uuid.New()
	event := EventGradePosted
	tok := UnsubscribeToken(secret, userID.String(), event)
	parsed, et, err := ParseUnsubscribeToken(secret, tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed != userID || et != event {
		t.Fatalf("got %v %q want %v %q", parsed, et, userID, event)
	}
}

func TestUnsubscribeTokenRejectsTamper(t *testing.T) {
	secret := "test-secret-at-least-32-characters-long"
	tok := UnsubscribeToken(secret, uuid.New().String(), EventGradePosted)
	_, _, err := ParseUnsubscribeToken(secret, tok+"x")
	if err == nil {
		t.Fatal("expected error")
	}
}
