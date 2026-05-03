package authservice

import "testing"

func TestMagicLinkSanitizeRedirect(t *testing.T) {
	base := "http://localhost:5173"
	t.Run("empty", func(t *testing.T) {
		p, err := magicLinkSanitizeRedirect(base, "")
		if err != nil || p != "" {
			t.Fatalf("got %q %v", p, err)
		}
	})
	t.Run("relative path", func(t *testing.T) {
		p, err := magicLinkSanitizeRedirect(base, "/courses/123")
		if err != nil || p != "/courses/123" {
			t.Fatalf("got %q %v", p, err)
		}
	})
	t.Run("reject protocol relative", func(t *testing.T) {
		if _, err := magicLinkSanitizeRedirect(base, "//evil.com/x"); err == nil {
			t.Fatal("expected error")
		}
	})
	t.Run("same origin absolute", func(t *testing.T) {
		p, err := magicLinkSanitizeRedirect(base, "http://localhost:5173/foo?q=1")
		if err != nil || p != "/foo?q=1" {
			t.Fatalf("got %q %v", p, err)
		}
	})
	t.Run("wrong host", func(t *testing.T) {
		if _, err := magicLinkSanitizeRedirect(base, "http://evil.com/foo"); err == nil {
			t.Fatal("expected error")
		}
	})
}
