package auth

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestBearerTokenExtractsValue(t *testing.T) {
	h := http.Header{"Authorization": []string{"Bearer abc.def.ghi"}}

	token, ok := BearerToken(h)
	if !ok || token != "abc.def.ghi" {
		t.Fatalf("BearerToken: token=%q ok=%v", token, ok)
	}
}

func TestBearerTokenMissingWithoutHeader(t *testing.T) {
	token, ok := BearerToken(http.Header{})
	if ok || token != "" {
		t.Fatalf("BearerToken missing: token=%q ok=%v", token, ok)
	}
}

func TestBearerTokenRequiresBearerScheme(t *testing.T) {
	h := http.Header{"Authorization": []string{"Basic Zm9v"}}

	token, ok := BearerToken(h)
	if ok || token != "" {
		t.Fatalf("BearerToken basic: token=%q ok=%v", token, ok)
	}
}

func TestBearerTokenRejectsBlankBearerToken(t *testing.T) {
	h := http.Header{"Authorization": []string{"Bearer    "}}

	token, ok := BearerToken(h)
	if ok || token != "" {
		t.Fatalf("BearerToken blank: token=%q ok=%v", token, ok)
	}
}

func TestUserFromRequest(t *testing.T) {
	signer := newTestSigner("unit-test-secret")
	token, err := signer.Sign(context.Background(), userID, "a@b.com")
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	req, err := http.NewRequest(http.MethodGet, "/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	user, err := UserFromRequest(req, signer)
	if err != nil {
		t.Fatalf("UserFromRequest: %v", err)
	}
	if user.UserID != userID || user.Email != "a@b.com" {
		t.Fatalf("user: %#v", user)
	}
}

func TestUserFromRequestRequiresSignerAndToken(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}

	if _, err := UserFromRequest(req, nil); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("UserFromRequest nil signer: %v", err)
	}
	if _, err := UserFromRequest(req, newTestSigner("unit-test-secret")); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("UserFromRequest missing token: %v", err)
	}
}
