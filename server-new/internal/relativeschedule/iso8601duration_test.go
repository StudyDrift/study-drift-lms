package relativeschedule

import "testing"

func TestParseISO8601Duration(t *testing.T) {
	for _, c := range []struct {
		in  string
		ok  bool
	}{
		{"P1D", true},
		{"P90D", true},
		{"P1Y2M3W4D", true},
		{"p1d", true},
		{"", false},
		{"P", false},
		{"P1X", false},
		{"P1D1", false},
		{"P0Y", false},
		{"P1M2D", true},
	} {
		err := ParseISO8601Duration(c.in)
		if c.ok && err != nil {
			t.Errorf("%q: %v", c.in, err)
		}
		if !c.ok && err == nil {
			t.Errorf("%q: expected error", c.in)
		}
	}
}
