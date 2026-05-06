package relativeschedule

import "testing"

func TestNormalizeRelativeDuration(t *testing.T) {
	got, err := NormalizeRelativeDuration(nil)
	if err != nil || got != nil {
		t.Fatalf("nil: %v %v", got, err)
	}

	empty := ""
	got, err = NormalizeRelativeDuration(&empty)
	if err != nil || got != nil {
		t.Fatalf("empty: %v %v", got, err)
	}

	whitespace := "   "
	got, err = NormalizeRelativeDuration(&whitespace)
	if err != nil || got != nil {
		t.Fatalf("ws: %v %v", got, err)
	}

	lower := "p1d"
	got, err = NormalizeRelativeDuration(&lower)
	if err != nil || got == nil || *got != "P1D" {
		t.Fatalf("got=%v err=%v", got, err)
	}

	bad := "junk"
	if _, err := NormalizeRelativeDuration(&bad); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseISO8601Duration_MoreCases(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{"P1Y", true},
		{"P1M", true},
		{"P1W", true},
		{"P1Y1D", true},
		{"   P1D   ", true},
		{"PD", false},
		{"P1Y1Y", false},
		{"PY", false},
	}
	for _, c := range cases {
		err := ParseISO8601Duration(c.in)
		if (err == nil) != c.ok {
			t.Errorf("%q: ok=%v err=%v", c.in, c.ok, err)
		}
	}
}
