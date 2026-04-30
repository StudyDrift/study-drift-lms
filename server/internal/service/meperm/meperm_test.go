package meperm

import (
	"errors"
	"testing"

	"github.com/lextures/lextures/server/internal/apierr"
)

func TestHTTPErrorFor(t *testing.T) {
	t.Parallel()
	s, c, m := HTTPErrorFor(ErrNotFound)
	if s != 404 {
		t.Fatalf("not found status: %d", s)
	}
	if c != apierr.CodeNotFound {
		t.Fatalf("code: %q", c)
	}
	_ = m
	s, c, m = HTTPErrorFor(&InvalidInput{Message: "x"})
	if s != 400 || c != "INVALID_INPUT" || m != "x" {
		t.Fatalf("invalid: %d %q %q", s, c, m)
	}
	s, _, _ = HTTPErrorFor(errors.New("other"))
	if s != 500 {
		t.Fatalf("other: %d", s)
	}
}
