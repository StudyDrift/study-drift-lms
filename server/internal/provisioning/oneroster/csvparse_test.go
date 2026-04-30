package oneroster

import (
	"errors"
	"strings"
	"testing"
)

func TestRequireCol_MissingSourcedId(t *testing.T) {
	idx := headerIndex([]string{"givenName", "familyName"})
	_, err := requireCol(idx, "users.csv", "sourcedId")
	if err == nil {
		t.Fatal("expected error")
	}
	var mc ErrMissingColumn
	if !errors.As(err, &mc) {
		t.Fatalf("expected ErrMissingColumn, got %v", err)
	}
	if mc.File != "users.csv" || mc.Column != "sourcedId" {
		t.Fatalf("err: %+v", mc)
	}
}

func TestParseCSV_StripsBOM(t *testing.T) {
	csv := "\xef\xbb\xbfsourcedId,email\nu1,a@b.co\n"
	h, rows, err := parseCSV("users.csv", strings.NewReader(csv))
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 2 || h[0] != "sourcedId" {
		t.Fatalf("header: %v", h)
	}
	if len(rows) != 1 || len(rows[0]) != 2 {
		t.Fatalf("rows: %v", rows)
	}
}
