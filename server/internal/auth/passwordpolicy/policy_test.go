package passwordpolicy

import (
	"strings"
	"testing"

	pwdb "github.com/lextures/lextures/server/internal/repos/passwordpolicy"
)

func TestLocalViolations_MinLength(t *testing.T) {
	t.Parallel()
	p := FromDBRow(pwdb.Row{MinLength: 12})
	if v := p.LocalViolations("short"); len(v) != 1 || v[0] != "password.min_length" {
		t.Fatalf("got %v", v)
	}
	if v := p.LocalViolations("longenoughpass"); len(v) != 0 {
		t.Fatalf("got %v", v)
	}
}

func TestInstitutionPolicyMinLength_AC6(t *testing.T) {
	t.Parallel()
	p := FromDBRow(pwdb.Row{MinLength: 12})
	if v := p.LocalViolations("elevenchars"); len(v) == 0 {
		t.Fatal("expected violation for 11 chars when min is 12")
	}
}

func TestHumanDetail(t *testing.T) {
	t.Parallel()
	p := FromDBRow(pwdb.Row{MinLength: 12})
	d := HumanDetail(p, []string{"password.min_length", "password.require_digit"})
	if d == "" || !strings.Contains(d, "12") {
		t.Fatalf("detail: %q", d)
	}
}

func TestStrengthLabel(t *testing.T) {
	t.Parallel()
	if StrengthLabel("abc") != StrengthWeak {
		t.Fatal()
	}
	if got := StrengthLabel("abcdefgh"); got != StrengthWeak {
		t.Fatalf("short single-class password: want weak got %q", got)
	}
	if got := StrengthLabel("Abcd1234"); got != StrengthFair {
		t.Fatalf("want fair got %q", got)
	}
	if got := StrengthLabel("Abcdefghijkl1!"); got != StrengthStrong {
		t.Fatalf("want strong got %q", got)
	}
}
