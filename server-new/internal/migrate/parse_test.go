package migrate

import "testing"

func TestNamePattern(t *testing.T) {
	if nameRe.MatchString("001_foo.sql") {
	} else {
		t.Fatal("expected match")
	}
	if nameRe.MatchString("bad.name.sql") {
		t.Fatal("no match")
	}
}
