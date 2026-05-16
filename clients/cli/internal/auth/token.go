package auth

import "time"

// TokenData holds the OAuth token payload persisted in keychain or file.
type TokenData struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	Expiry       time.Time `json:"expiry"`
}

// IsExpired reports whether the access token has expired.
func (t *TokenData) IsExpired() bool {
	return !t.Expiry.IsZero() && time.Now().After(t.Expiry)
}
