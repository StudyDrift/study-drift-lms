package httpserver

import (
	"strings"
	"testing"
)

func TestMarkdownFromHTML_ConvertsBasicFormatting(t *testing.T) {
	md := markdownFromHTML("<h2>Title</h2><p>Hello <strong>world</strong> and <a href=\"https://example.com\">link</a>.</p>")
	if !strings.Contains(md, "## Title") {
		t.Fatalf("expected heading markdown, got: %q", md)
	}
	if !strings.Contains(md, "**world**") {
		t.Fatalf("expected bold markdown, got: %q", md)
	}
	if !strings.Contains(md, "[link](https://example.com)") {
		t.Fatalf("expected link markdown, got: %q", md)
	}
}

func TestHTMLToPlainText_StripsTagsAndNormalizesBreaks(t *testing.T) {
	plain := htmlToPlainText("<p>One</p><p>Two<br/>Three</p>")
	if plain != "One\n\nTwo\nThree" {
		t.Fatalf("unexpected plain output: %q", plain)
	}
}
