package user

import "testing"

func TestNormalizeEmail(t *testing.T) {
	t.Parallel()
	if got := NormalizeEmail("  A@B.COM  "); got != "a@b.com" {
		t.Fatalf("got %q", got)
	}
}
