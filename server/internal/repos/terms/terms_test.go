package terms

import (
	"testing"
	"time"
)

func TestDeriveStatusFromDates(t *testing.T) {
	now := time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC)
	if got := DeriveStatusFromDates(now, "2026-08-01", "2026-12-15"); got != "active" {
		t.Fatalf("active inside range: got %q", got)
	}
	if got := DeriveStatusFromDates(now, "2026-10-01", "2026-12-15"); got != "upcoming" {
		t.Fatalf("upcoming before start: got %q", got)
	}
	if got := DeriveStatusFromDates(now, "2026-01-01", "2026-08-31"); got != "completed" {
		t.Fatalf("completed after end: got %q", got)
	}
}
