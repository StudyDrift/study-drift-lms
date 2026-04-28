// Email list parsing (port of `parse_email_list` in server/src/services/enrollments.rs).
package enrollments

import (
	"strings"
	"unicode"

	"github.com/lextures/lextures/server-new/internal/repos/user"
)

// ParseEmailList splits on commas, semicolons, newlines, and generic whitespace, normalizes, dedupes in order.
func ParseEmailList(raw string) []string {
	seen := make(map[string]struct{})
	var out []string
	split := func(r rune) bool {
		switch r {
		case ',', ';', '\n', '\r':
			return true
		}
		return unicode.IsSpace(r)
	}
	for _, part := range strings.FieldsFunc(raw, split) {
		if part == "" {
			continue
		}
		e := user.NormalizeEmail(part)
		if e == "" || !strings.Contains(e, "@") {
			continue
		}
		if _, ok := seen[e]; ok {
			continue
		}
		seen[e] = struct{}{}
		out = append(out, e)
	}
	return out
}
