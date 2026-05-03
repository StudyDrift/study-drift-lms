// Package auth contains authentication primitives shared by HTTP handlers.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/auth/sessionversion"
)

const (
	defaultTokenTTL   = 72 * time.Hour
	ltiEmbedTicketTTL = 15 * time.Minute
	// Rust jsonwebtoken's default validation allows 60 seconds of clock skew.
	jwtExpiryLeeway = time.Minute
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("expired token")
)

// AuthUser is the identity encoded in login JWTs.
type AuthUser struct {
	UserID string
	Email  string
}

// LTIEmbedTicket is the short-lived identity encoded for LTI iframe embeds.
type LTIEmbedTicket struct {
	UserID   string
	CourseID string
	ItemID   string
}

// JWTSigner signs and verifies legacy-compatible HS256 JWTs.
type JWTSigner struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
	pool   *pgxpool.Pool // optional; when set, login JWTs embed and validate jwt_session_version
}

// NewJWTSigner returns a signer with the same 72-hour login token TTL as the Rust server.
func NewJWTSigner(secret string) *JWTSigner {
	return &JWTSigner{
		secret: []byte(secret),
		ttl:    defaultTokenTTL,
		now:    time.Now,
	}
}

// NewJWTSignerWithPool is like NewJWTSigner but ties login tokens to users.jwt_session_version when verifying.
func NewJWTSignerWithPool(secret string, pool *pgxpool.Pool) *JWTSigner {
	j := NewJWTSigner(secret)
	j.pool = pool
	return j
}

// Sign creates a login JWT containing sub, email, exp, and optional session version (revocation).
func (s *JWTSigner) Sign(ctx context.Context, userID, email string) (string, error) {
	if !isUUID(userID) || strings.TrimSpace(email) == "" {
		return "", ErrInvalidToken
	}
	var sv int64
	if s.pool != nil {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return "", ErrInvalidToken
		}
		sv, err = sessionversion.Read(ctx, s.pool, uid)
		if err != nil {
			return "", ErrInvalidToken
		}
	}
	return s.sign(loginClaims{
		Subject:        userID,
		Email:          email,
		SessionVersion: sv,
		Expires:        unixSeconds(s.now().Add(s.ttl)),
	})
}

// Verify validates a login JWT and returns its authenticated user.
func (s *JWTSigner) Verify(ctx context.Context, token string) (AuthUser, error) {
	var claims loginClaims
	if err := s.verify(token, &claims); err != nil {
		return AuthUser{}, err
	}
	if !isUUID(claims.Subject) || strings.TrimSpace(claims.Email) == "" {
		return AuthUser{}, ErrInvalidToken
	}
	if isExpired(claims.Expires, s.now()) {
		return AuthUser{}, ErrExpiredToken
	}
	if s.pool != nil {
		uid, err := uuid.Parse(claims.Subject)
		if err != nil {
			return AuthUser{}, ErrInvalidToken
		}
		cur, err := sessionversion.Read(ctx, s.pool, uid)
		if err != nil {
			return AuthUser{}, ErrInvalidToken
		}
		if claims.SessionVersion != cur {
			return AuthUser{}, ErrInvalidToken
		}
	}
	return AuthUser{UserID: claims.Subject, Email: claims.Email}, nil
}

// SignLTIEmbedTicket creates a short-lived token for LTI iframe access without a Bearer header.
func (s *JWTSigner) SignLTIEmbedTicket(userID, courseID, itemID string) (string, error) {
	if !isUUID(userID) || !isUUID(courseID) || !isUUID(itemID) {
		return "", ErrInvalidToken
	}
	return s.sign(ltiEmbedTicketClaims{
		LTIEmbed: true,
		Subject:  userID,
		CourseID: courseID,
		ItemID:   itemID,
		Expires:  unixSeconds(s.now().Add(ltiEmbedTicketTTL)),
	})
}

// VerifyLTIEmbedTicket validates a short-lived LTI iframe token.
func (s *JWTSigner) VerifyLTIEmbedTicket(token string) (LTIEmbedTicket, error) {
	var claims ltiEmbedTicketClaims
	if err := s.verify(token, &claims); err != nil {
		return LTIEmbedTicket{}, err
	}
	if !claims.LTIEmbed || !isUUID(claims.Subject) || !isUUID(claims.CourseID) || !isUUID(claims.ItemID) {
		return LTIEmbedTicket{}, ErrInvalidToken
	}
	if isExpired(claims.Expires, s.now()) {
		return LTIEmbedTicket{}, ErrExpiredToken
	}
	return LTIEmbedTicket{UserID: claims.Subject, CourseID: claims.CourseID, ItemID: claims.ItemID}, nil
}

func (s *JWTSigner) sign(claims any) (string, error) {
	header, err := json.Marshal(jwtHeader{Algorithm: "HS256", Type: "JWT"})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	return unsigned + "." + s.signature(unsigned), nil
}

func (s *JWTSigner) verify(token string, claims any) error {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return ErrInvalidToken
	}
	unsigned := parts[0] + "." + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(s.signature(unsigned))) {
		return ErrInvalidToken
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return ErrInvalidToken
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return ErrInvalidToken
	}
	if header.Algorithm != "HS256" {
		return ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ErrInvalidToken
	}
	if err := json.Unmarshal(payload, claims); err != nil {
		return ErrInvalidToken
	}
	return nil
}

func (s *JWTSigner) signature(unsigned string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(unsigned))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

type jwtHeader struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ,omitempty"`
}

type loginClaims struct {
	Subject        string `json:"sub"`
	Email          string `json:"email"`
	SessionVersion int64  `json:"sv,omitempty"`
	Expires        int64  `json:"exp"`
}

type ltiEmbedTicketClaims struct {
	LTIEmbed bool   `json:"ltiEmbed"`
	Subject  string `json:"sub"`
	CourseID string `json:"course_id"`
	ItemID   string `json:"item_id"`
	Expires  int64  `json:"exp"`
}

func unixSeconds(t time.Time) int64 {
	return t.UTC().Unix()
}

func isExpired(exp int64, now time.Time) bool {
	return exp <= unixSeconds(now.Add(-jwtExpiryLeeway))
}

func isUUID(v string) bool {
	if len(v) != 36 {
		return false
	}
	for i, r := range v {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
				return false
			}
		}
	}
	return true
}
