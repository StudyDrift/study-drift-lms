package notifications

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const unsubscribeTokenTTL = 30 * 24 * time.Hour

// UnsubscribeToken signs user+event for one-click unsubscribe links.
func UnsubscribeToken(secret, userID, eventType string) string {
	exp := time.Now().UTC().Add(unsubscribeTokenTTL).Unix()
	payload := fmt.Sprintf("%s|%s|%d", userID, eventType, exp)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + sig))
}

// ParseUnsubscribeToken validates and returns user ID and event type.
func ParseUnsubscribeToken(secret, token string) (uuid.UUID, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil {
		return uuid.Nil, "", errors.New("invalid token")
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 4 {
		return uuid.Nil, "", errors.New("invalid token")
	}
	userID, err := uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, "", errors.New("invalid token")
	}
	eventType := parts[1]
	expUnix, err := parseInt64(parts[2])
	if err != nil {
		return uuid.Nil, "", errors.New("invalid token")
	}
	if time.Now().UTC().Unix() > expUnix {
		return uuid.Nil, "", errors.New("token expired")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%s|%s|%s", parts[0], parts[1], parts[2])
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[3])) {
		return uuid.Nil, "", errors.New("invalid token")
	}
	return userID, eventType, nil
}

func parseInt64(s string) (int64, error) {
	var n int64
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}
