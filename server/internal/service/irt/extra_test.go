package irt

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestCatModeEnabled(t *testing.T) {
	t.Setenv("IRT_CAT_MODE_ENABLED", "")
	if CatModeEnabled() {
		t.Fatal("empty -> false")
	}
	t.Setenv("IRT_CAT_MODE_ENABLED", "yes")
	if !CatModeEnabled() {
		t.Fatal("yes -> true")
	}
	t.Setenv("IRT_CAT_MODE_ENABLED", "true")
	if !CatModeEnabled() {
		t.Fatal("true")
	}
	t.Setenv("IRT_CAT_MODE_ENABLED", "no")
	if CatModeEnabled() {
		t.Fatal("no -> false")
	}
}

func TestService_Health(t *testing.T) {
	s := New()
	if s.Name != "irt" {
		t.Fatal("name")
	}
	got, err := s.Health(context.Background())
	if err != nil || got != "irt:ok" {
		t.Fatal()
	}
	if _, err := s.Health(nil); err == nil {
		t.Fatal("nil ctx")
	}
}

func fp(f float64) *float64 { return &f }

func TestSelectMaxInformationItem(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	c := uuid.New()
	cands := []struct {
		ID   uuid.UUID
		A, B *float64
	}{
		{a, fp(2.0), fp(0.0)},
		{b, fp(0.5), fp(1.0)},
		{c, nil, nil},
	}
	got := SelectMaxInformationItem(0.0, cands, nil, false)
	if got == nil || *got != a {
		t.Fatalf("expected a, got %v", got)
	}
	// exclude a; calibratedOnly=true skips c (uncalibrated) and only b is left
	got = SelectMaxInformationItem(0.0, cands, []uuid.UUID{a}, true)
	if got == nil || *got != b {
		t.Fatalf("calibratedOnly expected b, got %v", got)
	}
	// calibratedOnly skips c entirely
	got = SelectMaxInformationItem(0.0, cands, []uuid.UUID{a, b}, true)
	if got != nil {
		t.Fatalf("expected nil, got %v", got)
	}
	// calibratedOnly=false treats c as default (a=1,b=0)
	got = SelectMaxInformationItem(0.0, cands, []uuid.UUID{a, b}, false)
	if got == nil || *got != c {
		t.Fatalf("expected c, got %v", got)
	}
	// empty
	if SelectMaxInformationItem(0.0, nil, nil, false) != nil {
		t.Fatal("empty")
	}
}

func TestIccCurvePoints(t *testing.T) {
	pts := IccCurvePoints(1.0, 0.0, 0.0)
	if len(pts) < 5 {
		t.Fatalf("got %d", len(pts))
	}
	for _, p := range pts {
		if p[1] < 0 || p[1] > 1 {
			t.Fatalf("p out of range: %v", p)
		}
	}
	// c clamped
	pts2 := IccCurvePoints(1.0, 0.0, 0.5)
	if len(pts2) == 0 {
		t.Fatal("empty")
	}
	pts3 := IccCurvePoints(1.0, 0.0, -0.5)
	if len(pts3) == 0 {
		t.Fatal("neg c clamped")
	}
}

func TestSortUniqueUUIDs(t *testing.T) {
	a := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	b := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	in := []uuid.UUID{b, a, b, a}
	out := SortUniqueUUIDs(in)
	if len(out) != 2 || out[0] != a || out[1] != b {
		t.Fatalf("got %v", out)
	}
	if got := SortUniqueUUIDs(nil); len(got) != 0 {
		t.Fatal("nil")
	}
	if got := SortUniqueUUIDs([]uuid.UUID{}); len(got) != 0 {
		t.Fatal("empty")
	}
}
