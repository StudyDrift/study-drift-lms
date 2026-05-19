package video

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestJitsiProvider_UnsignedRoom(t *testing.T) {
	p := &JitsiProvider{BaseURL: "https://meet.jit.si"}
	params := MeetingParams{
		MeetingID:  uuid.MustParse("00000000-0000-0000-0000-000000000001"),
		CourseCode: "C-TEST01",
		Title:      "Test Meeting",
	}
	urls, err := p.CreateMeeting(context.Background(), params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(urls.JoinURL, "https://meet.jit.si/") {
		t.Errorf("joinURL: %q", urls.JoinURL)
	}
	if urls.JoinURL != urls.HostURL {
		t.Error("unsigned provider: joinURL and hostURL should be equal")
	}
}

func TestJitsiProvider_SignedRoom(t *testing.T) {
	p := &JitsiProvider{
		BaseURL:   "https://meet.example.com",
		AppID:     "testapp",
		AppSecret: "testsecret",
	}
	params := MeetingParams{
		MeetingID:  uuid.MustParse("00000000-0000-0000-0000-000000000002"),
		CourseCode: "C-SIGNED",
		Title:      "Signed Meeting",
	}
	urls, err := p.CreateMeeting(context.Background(), params)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(urls.JoinURL, "jwt=") {
		t.Errorf("joinURL should contain jwt param: %q", urls.JoinURL)
	}
	if !strings.Contains(urls.HostURL, "jwt=") {
		t.Errorf("hostURL should contain jwt param: %q", urls.HostURL)
	}
	// Host and student tokens should differ (moderator flag differs).
	if urls.JoinURL == urls.HostURL {
		t.Error("signed provider: joinURL and hostURL should differ (different JWT claims)")
	}
}

func TestJitsiRoomName(t *testing.T) {
	id := uuid.MustParse("12345678-1234-1234-1234-123456789abc")
	name := jitsiRoomName("C-HELLO 01", id)
	// Must be URL-safe (no spaces).
	if strings.Contains(name, " ") {
		t.Errorf("room name has spaces: %q", name)
	}
	if !strings.HasPrefix(name, "lex-") {
		t.Errorf("room name prefix: %q", name)
	}
}
