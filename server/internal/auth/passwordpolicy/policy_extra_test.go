package passwordpolicy

import (
	"strings"
	"testing"

	pwdb "github.com/lextures/lextures/server/internal/repos/passwordpolicy"
)

func TestLocalViolations_AllRequired(t *testing.T) {
	p := FromDBRow(pwdb.Row{
		MinLength:      8,
		RequireUpper:   true,
		RequireLower:   true,
		RequireDigit:   true,
		RequireSpecial: true,
	})
	v := p.LocalViolations("abc")
	codes := strings.Join(v, ",")
	for _, want := range []string{
		"password.min_length",
		"password.require_upper",
		"password.require_digit",
		"password.require_special",
	} {
		if !strings.Contains(codes, want) {
			t.Errorf("missing %q in %v", want, v)
		}
	}
	if v := p.LocalViolations("Abc1!xyz"); len(v) != 0 {
		t.Fatalf("expected pass: %v", v)
	}
	// Lower required
	v = p.LocalViolations("ABC1!XYZ")
	if !strings.Contains(strings.Join(v, ","), "password.require_lower") {
		t.Fatal("require_lower")
	}
}

func TestHumanDetail_AllCodes(t *testing.T) {
	p := Policy{MinLength: 14}
	d := HumanDetail(p, []string{
		"password.min_length",
		"password.require_upper",
		"password.require_lower",
		"password.require_digit",
		"password.require_special",
		"password.unknown",
	})
	for _, w := range []string{"14", "uppercase", "lowercase", "digit", "symbol", "does not meet"} {
		if !strings.Contains(d, w) {
			t.Errorf("missing %q in %q", w, d)
		}
	}
	if HumanDetail(p, nil) != "" {
		t.Fatal("empty violations -> empty")
	}
}

func TestItoa_Zero(t *testing.T) {
	if HumanDetail(Policy{MinLength: 0}, []string{"password.min_length"}) != "Use at least 0 characters." {
		t.Fatal()
	}
}

func TestStrengthDisplayEnglish(t *testing.T) {
	cases := map[string]string{
		StrengthWeak:   "Weak",
		StrengthFair:   "Fair",
		StrengthStrong: "Strong",
		"unknown":      "",
	}
	for k, want := range cases {
		if got := StrengthDisplayEnglish(k); got != want {
			t.Errorf("%q: got %q want %q", k, got, want)
		}
	}
}
