package httpserver

import (
	"net/url"
	"testing"
	"time"
)

func TestParseLearningActivityTimeRange_defaults(t *testing.T) {
	now, err := time.Parse(time.RFC3339, "2026-04-15T12:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	from, to, err := parseLearningActivityTimeRange(url.Values{}, now)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !to.Equal(now) {
		t.Fatalf("to: got %v", to)
	}
	if got := to.Sub(from); got != 30*24*time.Hour {
		t.Fatalf("from default 30d before to: from=%v to=%v sub=%v", from, to, got)
	}
}

func TestParseLearningActivityTimeRange_explicit(t *testing.T) {
	now := time.Unix(0, 0).UTC()
	v := url.Values{}
	v.Set("from", "2026-01-01T00:00:00Z")
	v.Set("to", "2026-01-20T00:00:00Z")
	from, to, err := parseLearningActivityTimeRange(v, now)
	if err != nil {
		t.Fatal(err)
	}
	if from.Format(time.RFC3339) != "2026-01-01T00:00:00Z" || to.Format(time.RFC3339) != "2026-01-20T00:00:00Z" {
		t.Fatalf("got from=%v to=%v", from, to)
	}
}

func TestParseLearningActivityTimeRange_invalidRFC3339(t *testing.T) {
	v := url.Values{}
	v.Set("from", "not-a-date")
	_, _, err := parseLearningActivityTimeRange(v, time.Now().UTC())
	if err == nil {
		t.Fatal("expected err")
	}
}

func TestParseLearningActivityTimeRange_fromNotBeforeTo(t *testing.T) {
	now := time.Unix(0, 0).UTC()
	v := url.Values{}
	v.Set("from", "2026-01-20T00:00:00Z")
	v.Set("to", "2026-01-20T00:00:00Z")
	_, _, err := parseLearningActivityTimeRange(v, now)
	if err == nil {
		t.Fatal("expected err")
	}
}

func TestParseLearningActivityTimeRange_tooLong(t *testing.T) {
	now := time.Unix(0, 0).UTC()
	v := url.Values{}
	v.Set("from", "2025-01-01T00:00:00Z")
	v.Set("to", "2026-01-05T00:00:00Z")
	_, _, err := parseLearningActivityTimeRange(v, now)
	if err == nil {
		t.Fatal("expected err for > 366d")
	}
}

func TestParseLearningActivityTimeRange_max366DaysAllowed(t *testing.T) {
	now := time.Unix(0, 0).UTC()
	v := url.Values{}
	v.Set("from", "2025-01-01T00:00:00Z")
	v.Set("to", "2026-01-01T00:00:00Z")
	// 365 days; must succeed
	_, _, err := parseLearningActivityTimeRange(v, now)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}
