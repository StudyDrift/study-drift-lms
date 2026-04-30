package communication

import "unicode/utf8"

// MakeSnippet normalizes a body to a 120-rune head plus an ellipsis, matching the Rust server.
func MakeSnippet(body string) string {
	const max = 120
	r := []rune(body)
	if utf8.RuneCountInString(body) <= max {
		return body
	}
	return string(r[:max]) + "…"
}
