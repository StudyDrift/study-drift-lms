package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const (
	userID   = "2a2aab00-77a5-4b47-9e18-7d78d3c0a111"
	courseID = "483a0126-8354-4528-8d79-3139f4024992"
	itemID   = "10e3448e-88ee-46d4-9d26-14e70a799d73"
)

func TestJWTSignerSignVerifyRoundTrip(t *testing.T) {
	signer := newTestSigner("unit-test-secret")

	token, err := signer.Sign(context.Background(), userID, "a@b.com")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	user, err := signer.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if user.UserID != userID || user.Email != "a@b.com" {
		t.Fatalf("user: %#v", user)
	}
}

func TestJWTSignerWrongSecretFailsVerify(t *testing.T) {
	a := newTestSigner("secret-a")
	b := newTestSigner("secret-b")

	token, err := a.Sign(context.Background(), userID, "x@y.z")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if _, err := b.Verify(context.Background(), token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Verify with wrong secret: %v", err)
	}
}

func TestJWTSignerRejectsExpiredToken(t *testing.T) {
	signer := newTestSigner("unit-test-secret")
	token, err := signer.Sign(context.Background(), userID, "a@b.com")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	signer.now = func() time.Time { return fixedNow().Add(defaultTokenTTL + jwtExpiryLeeway + time.Second) }
	if _, err := signer.Verify(context.Background(), token); !errors.Is(err, ErrExpiredToken) {
		t.Fatalf("Verify expired: %v", err)
	}
}

func TestJWTSignerRejectsMalformedLoginClaims(t *testing.T) {
	signer := newTestSigner("unit-test-secret")

	token, err := signer.sign(loginClaims{
		Subject: "not-a-uuid",
		Email:   "a@b.com",
		Expires: unixSeconds(fixedNow().Add(time.Hour)),
	})
	if err != nil {
		t.Fatalf("sign raw claims: %v", err)
	}
	if _, err := signer.Verify(context.Background(), token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Verify malformed claims: %v", err)
	}
}

func TestJWTSignerRejectsUnsupportedAlgorithm(t *testing.T) {
	signer := newTestSigner("unit-test-secret")
	token, err := signer.Sign(context.Background(), userID, "a@b.com")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	parts := strings.Split(token, ".")
	header, err := json.Marshal(jwtHeader{Algorithm: "none", Type: "JWT"})
	if err != nil {
		t.Fatalf("Marshal header: %v", err)
	}
	parts[0] = base64.RawURLEncoding.EncodeToString(header)
	parts[2] = signer.signature(parts[0] + "." + parts[1])

	if _, err := signer.Verify(context.Background(), strings.Join(parts, ".")); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Verify unsupported alg: %v", err)
	}
}

func TestJWTSignerLTIEmbedTicketRoundTrip(t *testing.T) {
	signer := newTestSigner("unit-test-secret")

	token, err := signer.SignLTIEmbedTicket(userID, courseID, itemID)
	if err != nil {
		t.Fatalf("SignLTIEmbedTicket: %v", err)
	}
	ticket, err := signer.VerifyLTIEmbedTicket(token)
	if err != nil {
		t.Fatalf("VerifyLTIEmbedTicket: %v", err)
	}
	if ticket.UserID != userID || ticket.CourseID != courseID || ticket.ItemID != itemID {
		t.Fatalf("ticket: %#v", ticket)
	}
}

func TestJWTSignerLoginTokenIsNotLTIEmbedTicket(t *testing.T) {
	signer := newTestSigner("unit-test-secret")
	token, err := signer.Sign(context.Background(), userID, "a@b.com")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	if _, err := signer.VerifyLTIEmbedTicket(token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("VerifyLTIEmbedTicket(login token): %v", err)
	}
}

func TestJWTSignerRejectsInvalidInput(t *testing.T) {
	signer := newTestSigner("unit-test-secret")

	if _, err := signer.Sign(context.Background(), "not-a-uuid", "a@b.com"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Sign invalid user id: %v", err)
	}
	if _, err := signer.Sign(context.Background(), userID, " "); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Sign invalid email: %v", err)
	}
	if _, err := signer.SignLTIEmbedTicket(userID, courseID, "not-a-uuid"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("SignLTIEmbedTicket invalid item id: %v", err)
	}
	if _, err := signer.Verify(context.Background(), "not.a.jwt"); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Verify malformed token: %v", err)
	}
}

func TestJWTSignerLoginClaimsOmitemptySessionVersion(t *testing.T) {
	signer := newTestSigner("unit-test-secret")
	token, err := signer.sign(loginClaims{
		Subject: userID,
		Email:   "a@b.com",
		Expires: unixSeconds(fixedNow().Add(time.Hour)),
	})
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("jwt parts: %d", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payload, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["sv"]; ok {
		t.Fatalf("expected sv omitted when zero, got %s", raw["sv"])
	}
}

func newTestSigner(secret string) *JWTSigner {
	signer := NewJWTSigner(secret)
	signer.now = fixedNow
	return signer
}

func fixedNow() time.Time {
	return time.Date(2026, 4, 24, 12, 0, 0, 0, time.UTC)
}
