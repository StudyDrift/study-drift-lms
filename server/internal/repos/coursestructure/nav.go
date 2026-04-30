package coursestructure

import (
	"github.com/google/uuid"
)

// NavigableKind is true for outline items a learner can open (modules omitted).
func NavigableKind(kind string) bool {
	switch kind {
	case "content_page", "assignment", "quiz", "external_link", "survey", "lti_link":
		return true
	default:
		return false
	}
}

// NavigableIDsInOutlineOrder returns navigable item ids in outline order (Rust `navigable_ids_in_outline_order`).
func NavigableIDsInOutlineOrder(rows []ItemRow) []uuid.UUID {
	ordered := OrderRows(rows)
	out := make([]uuid.UUID, 0, len(ordered))
	for i := range ordered {
		if NavigableKind(ordered[i].Kind) {
			out = append(out, ordered[i].ID)
		}
	}
	return out
}
