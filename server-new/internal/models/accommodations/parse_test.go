package accommodations

import (
	"database/sql"
	"testing"
	"time"
)

func TestParseDate(t *testing.T) {
	t.Parallel()
	s := "2026-04-01"
	got, err := ParseDate(&s)
	if err != nil || got == nil {
		t.Fatalf("parse: %v %v", got, err)
	}
	if got.Year() != 2026 || got.Month() != time.April || got.Day() != 1 {
		t.Fatalf("parts: %v", got)
	}
	empty := ""
	_, err = ParseDate(&empty)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseDate(nil); err != nil {
		t.Fatal(err)
	}
}

func TestYYYYMMDDFromNull(t *testing.T) {
	t.Parallel()
	var nt sql.NullTime
	if p := YYYYMMDDFromNull(nt); p != nil {
		t.Fatalf("expected nil, got %v", *p)
	}
	nt = sql.NullTime{Time: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), Valid: true}
	p := YYYYMMDDFromNull(nt)
	if p == nil || *p != "2026-01-02" {
		t.Fatalf("got %v", p)
	}
}
