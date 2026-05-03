package deviceua

import "testing"

func TestLabel(t *testing.T) {
	if got := Label(""); got != "Unknown device" {
		t.Fatalf("empty: %q", got)
	}
	if got := Label("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"); got != "Chrome on Windows" {
		t.Fatalf("chrome windows: %q", got)
	}
}
