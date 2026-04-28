package accommodations

import (
	"database/sql"
	"testing"
	"time"
)

func TestInstructorFlagLabels(t *testing.T) {
	t.Parallel()
	labels := InstructorFlagLabels(Effective{
		TimeMultiplier:     1.5,
		ExtraAttempts:     1,
		HintsAlwaysEnabled: true,
		ReducedDistraction:  true,
	})
	want := []string{"extended_time", "extra_attempts", "reduced_distraction", "always_allow_hints"}
	if len(labels) != len(want) {
		t.Fatalf("got %v", labels)
	}
	for i := range want {
		if labels[i] != want[i] {
			t.Fatalf("at %d: got %q want %q (full %v)", i, labels[i], want[i], labels)
		}
	}
}

func TestFromRow_Nil(t *testing.T) {
	t.Parallel()
	e := FromRow(nil)
	if e.TimeMultiplier != 1 || e.ExtraAttempts != 0 {
		t.Fatalf("defaults: %#v", e)
	}
}

func TestRowActiveOnDate(t *testing.T) {
	t.Parallel()
	day := time.Date(2026, 4, 10, 15, 0, 0, 0, time.UTC)
	from := sql.NullTime{Time: time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), Valid: true}
	until := sql.NullTime{Time: time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC), Valid: true}
	if !RowActiveOnDate(from, until, day) {
		t.Fatal("expected active in range")
	}
	if RowActiveOnDate(from, until, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatal("expected before from")
	}
}
