package srs

import (
	"math"
	"testing"
)

func TestSm2Step_firstGood(t *testing.T) {
	s1 := Sm2Step(DefaultSm2State(), 4)
	if math.Abs(s1.IntervalDays-1.0) > 1e-9 || s1.Repetition != 1 {
		t.Fatalf("%+v", s1)
	}
}

func TestGradeToQuality(t *testing.T) {
	q, ok := GradeToQuality("  GOOD ")
	if !ok || math.Abs(q-4.0) > 1e-9 {
		t.Fatal(q, ok)
	}
	if _, ok := GradeToQuality("nope"); ok {
		t.Fatal("expected false")
	}
}
