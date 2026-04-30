package syllabusmarkups

import (
	"strings"
)

// Max lengths (parity with server/src/repos/content_page_markups.rs).
const (
	maxQuoteLen        = 24_000
	maxCommentLen      = 8_000
	maxNotebookPageLen = 128
)

// ValidateRequest returns a non-empty error string if the body is invalid.
func ValidateRequest(kind, quote string, notebookPageID, comment *string) string {
	if strings.TrimSpace(quote) == "" {
		return "quoteText must not be empty."
	}
	if len(quote) > maxQuoteLen {
		return "quoteText is too long."
	}
	if comment != nil && len(*comment) > maxCommentLen {
		return "commentText is too long."
	}
	if notebookPageID != nil && len(*notebookPageID) > maxNotebookPageLen {
		return "notebookPageId is too long."
	}
	switch kind {
	case "highlight":
		// Parity: highlight must not send notebookPageId or commentText (even empty).
		if notebookPageID != nil || comment != nil {
			return "highlight must not include notebookPageId or commentText."
		}
		return ""
	case "note":
		if notebookPageID == nil || strings.TrimSpace(*notebookPageID) == "" {
			return "note requires notebookPageId."
		}
		return ""
	default:
		return "kind must be highlight or note."
	}
}
