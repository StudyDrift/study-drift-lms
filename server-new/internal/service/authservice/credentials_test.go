package authservice

import (
	"errors"
	"net/http"
	"testing"

	"github.com/lextures/lextures/server-new/internal/apierr"
)

func TestForgotMessageIsStable(t *testing.T) {
	t.Parallel()
	if forgotMsg().Message == "" {
		t.Fatal("empty")
	}
}

func TestFieldError(t *testing.T) {
	t.Parallel()
	e := FieldError{Message: "x"}
	if e.Error() != "x" {
		t.Fatalf("Error: %q", e.Error())
	}
}

func TestHTTPErrorFor(t *testing.T) {
	t.Parallel()
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{FieldError{Message: "bad"}, http.StatusBadRequest, apierr.CodeInvalidInput},
		{ErrInvalidCredentials, http.StatusUnauthorized, apierr.CodeInvalidCredentials},
		{ErrEmailTaken, http.StatusConflict, apierr.CodeEmailTaken},
		{ErrInvalidResetToken, http.StatusBadRequest, apierr.CodeInvalidResetToken},
		{errors.New("mystery"), http.StatusInternalServerError, apierr.CodeInternal},
	}
	for _, tc := range cases {
		st, code, _ := HTTPErrorFor(tc.err)
		if st != tc.status || code != tc.code {
			t.Fatalf("err %v: got %d %q want %d %q", tc.err, st, code, tc.status, tc.code)
		}
	}
}

func TestContainsAt(t *testing.T) {
	t.Parallel()
	if !containsAt("a@b") {
		t.Fatal("want @")
	}
	if containsAt("nope") {
		t.Fatal("no @")
	}
}

func TestTrimStringPtr(t *testing.T) {
	t.Parallel()
	if trimStringPtr(nil) != nil {
		t.Fatal("nil in")
	}
	empty := ""
	if trimStringPtr(&empty) != nil {
		t.Fatal("empty")
	}
	s := "  x  "
	if p := trimStringPtr(&s); p == nil || *p != "x" {
		t.Fatalf("got %v", p)
	}
}

func TestValidateLoginSignup(t *testing.T) {
	t.Parallel()
	if err := validateLogin(&LoginRequest{Email: " ", Password: "p"}); err == nil {
		t.Fatal("want err")
	}
	if err := validateSignup(&SignupRequest{Email: "bad", Password: "12345678"}); err == nil {
		t.Fatal("want err for email")
	}
	if err := validateSignup(&SignupRequest{Email: "a@b.com", Password: "short"}); err == nil {
		t.Fatal("want err for short password")
	}
	if err := validateSignup(&SignupRequest{Email: "a@b.com", Password: "12345678"}); err != nil {
		t.Fatal(err)
	}
}
