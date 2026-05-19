package video

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// BBBProvider creates rooms using the BigBlueButton REST API.
type BBBProvider struct {
	BaseURL string // e.g. "https://bbb.example.com/bigbluebutton"
	Secret  string // BBB shared secret
}

func (b *BBBProvider) Name() string { return "bbb" }

// CreateMeeting calls the BBB "create" API and returns join URLs.
func (b *BBBProvider) CreateMeeting(ctx context.Context, p MeetingParams) (*MeetingURLs, error) {
	meetingID := "lex-" + p.MeetingID.String()
	name := p.Title
	if name == "" {
		name = meetingID
	}

	params := url.Values{}
	params.Set("meetingID", meetingID)
	params.Set("name", name)
	params.Set("record", "true")
	if p.ScheduledStart != nil {
		// BBB doesn't pre-schedule; room is created immediately.
		_ = p.ScheduledStart
	}

	createURL := b.signedURL("create", params)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, createURL, nil)
	if err != nil {
		return nil, fmt.Errorf("bbb: build request: %w", err)
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("bbb: create room: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bbb: create room status %d: %s", resp.StatusCode, body)
	}

	// Build join URLs (student and moderator).
	joinParams := url.Values{}
	joinParams.Set("meetingID", meetingID)
	joinParams.Set("fullName", "Student")
	joinParams.Set("role", "VIEWER")
	joinURL := b.signedURL("join", joinParams)

	hostParams := url.Values{}
	hostParams.Set("meetingID", meetingID)
	hostParams.Set("fullName", "Instructor")
	hostParams.Set("role", "MODERATOR")
	hostURL := b.signedURL("join", hostParams)

	return &MeetingURLs{JoinURL: joinURL, HostURL: hostURL}, nil
}

// signedURL builds a BBB API URL with checksum.
func (b *BBBProvider) signedURL(call string, params url.Values) string {
	base := strings.TrimRight(b.BaseURL, "/") + "/api/" + call
	query := params.Encode()
	checksum := bbbChecksum(call, query, b.Secret)
	return fmt.Sprintf("%s?%s&checksum=%s", base, query, checksum)
}

func bbbChecksum(call, params, secret string) string {
	h := sha256.Sum256([]byte(call + params + secret))
	return fmt.Sprintf("%x", h)
}
