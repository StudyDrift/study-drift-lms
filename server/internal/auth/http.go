package auth

import (
	"net/http"
	"strings"
)

// BearerToken extracts a trimmed Bearer token from an Authorization header.
func BearerToken(h http.Header) (string, bool) {
	value := h.Get("Authorization")
	token, ok := strings.CutPrefix(value, "Bearer ")
	if !ok {
		return "", false
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", false
	}
	return token, true
}

// UserFromRequest authenticates the request using its Bearer token.
func UserFromRequest(r *http.Request, signer *JWTSigner) (AuthUser, error) {
	if signer == nil {
		return AuthUser{}, ErrInvalidToken
	}
	token, ok := BearerToken(r.Header)
	if !ok {
		return AuthUser{}, ErrInvalidToken
	}
	return signer.Verify(r.Context(), token)
}
