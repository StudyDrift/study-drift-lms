package communication

import (
	"strings"
	"testing"
)

func TestMakeSnippet(t *testing.T) {
	t.Parallel()
	if s := MakeSnippet("hi"); s != "hi" {
		t.Fatalf("short: %q", s)
	}
	long := strings.Repeat("a", 200)
	out := MakeSnippet(long)
	if len([]rune(out)) != 121 { // 120 + ellipsis
		t.Fatalf("len %d: %q", len([]rune(out)), out)
	}
}
