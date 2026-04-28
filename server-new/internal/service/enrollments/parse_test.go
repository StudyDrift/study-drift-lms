package enrollments

import "testing"

func TestParseEmailList(t *testing.T) {
	raw := " a@b.com , b@c.com\na@b.com ;  c@d.com  "
	got := ParseEmailList(raw)
	if len(got) != 3 {
		t.Fatalf("got %v", got)
	}
	if got[0] != "a@b.com" || got[1] != "b@c.com" || got[2] != "c@d.com" {
		t.Fatalf("got %v", got)
	}
}
