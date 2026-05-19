package video

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// JitsiProvider creates signed JWT room links for Jitsi Meet.
type JitsiProvider struct {
	BaseURL   string // e.g. "https://meet.jit.si" or self-hosted URL
	AppID     string // Jitsi app_id (from jaas.8x8.vc or self-hosted)
	AppSecret string // Jitsi app_secret for HMAC-SHA256 signing (empty = unsigned)
}

func (j *JitsiProvider) Name() string { return "jitsi" }

// CreateMeeting generates a Jitsi meeting URL (with optional JWT token).
func (j *JitsiProvider) CreateMeeting(_ context.Context, p MeetingParams) (*MeetingURLs, error) {
	roomName := jitsiRoomName(p.CourseCode, p.MeetingID)
	base := strings.TrimRight(j.BaseURL, "/")
	if base == "" {
		base = "https://meet.jit.si"
	}

	if j.AppSecret == "" {
		joinURL := fmt.Sprintf("%s/%s", base, roomName)
		return &MeetingURLs{JoinURL: joinURL, HostURL: joinURL}, nil
	}

	now := time.Now()
	exp := now.Add(2 * time.Hour)

	studentTok, err := jitsiJWT(j.AppID, j.AppSecret, roomName, false, now, exp)
	if err != nil {
		return nil, fmt.Errorf("jitsi: sign student jwt: %w", err)
	}
	hostTok, err := jitsiJWT(j.AppID, j.AppSecret, roomName, true, now, exp)
	if err != nil {
		return nil, fmt.Errorf("jitsi: sign host jwt: %w", err)
	}

	joinURL := fmt.Sprintf("%s/%s?jwt=%s", base, roomName, studentTok)
	hostURL := fmt.Sprintf("%s/%s?jwt=%s", base, roomName, hostTok)
	return &MeetingURLs{JoinURL: joinURL, HostURL: hostURL}, nil
}

func jitsiRoomName(courseCode string, id uuid.UUID) string {
	// Sanitize courseCode for URL safety.
	safe := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return '-'
	}, courseCode)
	return fmt.Sprintf("lex-%s-%s", safe, id.String()[:8])
}

// jitsiJWT builds a HS256 JWT for Jitsi Meet room access.
func jitsiJWT(appID, secret, room string, moderator bool, iat, exp time.Time) (string, error) {
	header := base64url(mustJSON(map[string]string{"alg": "HS256", "typ": "JWT"}))
	claims := map[string]interface{}{
		"iss":  appID,
		"sub":  "*",
		"aud":  "jitsi",
		"room": room,
		"iat":  iat.Unix(),
		"exp":  exp.Unix(),
		"context": map[string]interface{}{
			"user": map[string]interface{}{
				"moderator": moderator,
			},
		},
	}
	payload := base64url(mustJSON(claims))
	signingInput := header + "." + payload
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + sig, nil
}

func base64url(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func mustJSON(v interface{}) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
