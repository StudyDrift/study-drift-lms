package gradingdisplay

import (
	"encoding/json"
	"math"
	"testing"
)

func TestParseKindAndString(t *testing.T) {
	cases := map[string]Kind{
		"points":              Points,
		"percentage":          Percentage,
		"letter":              Letter,
		"gpa":                 Gpa,
		"pass_fail":           PassFail,
		"complete_incomplete": CompleteIncomplete,
	}
	for s, want := range cases {
		k, ok := ParseKind(s)
		if !ok || k != want {
			t.Errorf("ParseKind(%q): got %v ok=%v", s, k, ok)
		}
		if k.String() != s {
			t.Errorf("String(%v) = %q want %q", k, k.String(), s)
		}
	}
	if _, ok := ParseKind("garbage"); ok {
		t.Error("expected !ok for garbage")
	}
	if _, ok := ParseKind("  letter  "); !ok {
		t.Error("expected trim to work")
	}
	// Default Kind String
	if Kind(127).String() != "points" {
		t.Error("default String should be points")
	}
}

func TestParseScale_PointsPercentage(t *testing.T) {
	if _, err := ParseScale(Points, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseScale(Percentage, nil); err != nil {
		t.Fatal(err)
	}
}

func TestParseScale_LetterErrors(t *testing.T) {
	if _, err := ParseScale(Letter, nil); err == nil {
		t.Fatal("expected nil scale error")
	}
	empty := json.RawMessage("[]")
	if _, err := ParseScale(Letter, &empty); err == nil {
		t.Fatal("expected empty array error")
	}
	bad := json.RawMessage(`[{"label":"","min_pct":0}]`)
	if _, err := ParseScale(Letter, &bad); err == nil {
		t.Fatal("expected empty label error")
	}
	oor := json.RawMessage(`[{"label":"A","min_pct":150}]`)
	if _, err := ParseScale(Letter, &oor); err == nil {
		t.Fatal("expected min_pct out of range")
	}
	noZero := json.RawMessage(`[{"label":"A","min_pct":50}]`)
	if _, err := ParseScale(Letter, &noZero); err == nil {
		t.Fatal("expected lowest must be 0 error")
	}
	dup := json.RawMessage(`[{"label":"A","min_pct":0},{"label":"B","min_pct":0}]`)
	if _, err := ParseScale(Letter, &dup); err == nil {
		t.Fatal("expected strictly increasing error")
	}
	badJSON := json.RawMessage(`not json`)
	if _, err := ParseScale(Letter, &badJSON); err == nil {
		t.Fatal("expected json error")
	}
}

func TestParseScale_LetterOK(t *testing.T) {
	g4 := 4.0
	g3 := 3.0
	tiers := []struct {
		Label  string   `json:"label"`
		MinPct float64  `json:"min_pct"`
		Gpa    *float64 `json:"gpa"`
	}{
		{"A", 90, &g4},
		{"B", 80, &g3},
		{"F", 0, nil},
	}
	b, _ := json.Marshal(tiers)
	rm := json.RawMessage(b)
	p, err := ParseScale(Letter, &rm)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.LetterTiers) != 3 || p.LetterTiers[0].Label != "A" {
		t.Fatalf("expected sorted desc: %+v", p.LetterTiers)
	}
}

func TestParseScale_PassFail(t *testing.T) {
	p, err := ParseScale(PassFail, nil)
	if err != nil || p.PassMinPct != 60 {
		t.Fatalf("default pass_min_pct = %v, err=%v", p.PassMinPct, err)
	}
	rm := json.RawMessage(`{"pass_min_pct":70}`)
	p, err = ParseScale(PassFail, &rm)
	if err != nil || p.PassMinPct != 70 {
		t.Fatalf("got %v err=%v", p.PassMinPct, err)
	}
	bad := json.RawMessage(`{"pass_min_pct":150}`)
	if _, err := ParseScale(PassFail, &bad); err == nil {
		t.Fatal("expected oor error")
	}
}

func TestParseScale_CompleteIncomplete(t *testing.T) {
	p, err := ParseScale(CompleteIncomplete, nil)
	if err != nil || p.CompleteMinPct != 50 {
		t.Fatal("default")
	}
	rm := json.RawMessage(`{"complete_min_pct":75}`)
	p, _ = ParseScale(CompleteIncomplete, &rm)
	if p.CompleteMinPct != 75 {
		t.Fatal("override")
	}
	bad := json.RawMessage(`{"complete_min_pct":-1}`)
	if _, err := ParseScale(CompleteIncomplete, &bad); err == nil {
		t.Fatal("expected error")
	}
}

func TestResolveEffective(t *testing.T) {
	pct := Percentage
	if k := ResolveEffective(nil, nil); k != Points {
		t.Fatal("default points")
	}
	if k := ResolveEffective(&pct, nil); k != Percentage {
		t.Fatal("course kind")
	}
	override := "letter"
	if k := ResolveEffective(&pct, &override); k != Letter {
		t.Fatal("override letter")
	}
	bad := "junk"
	if k := ResolveEffective(&pct, &bad); k != Percentage {
		t.Fatal("fall through to course")
	}
	empty := ""
	if k := ResolveEffective(&pct, &empty); k != Percentage {
		t.Fatal("empty override falls through")
	}
}

func TestToDisplayGrade_Points(t *testing.T) {
	if got := ToDisplayGrade(85, nil, nil, Points); got != "85" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(85.5, nil, nil, Points); got != "85.5" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(math.NaN(), nil, nil, Points); got != "" {
		t.Errorf("NaN got %q", got)
	}
	if got := ToDisplayGrade(-1, nil, nil, Points); got != "" {
		t.Errorf("neg got %q", got)
	}
	if got := ToDisplayGrade(math.Inf(1), nil, nil, Points); got != "" {
		t.Errorf("inf got %q", got)
	}
}

func TestToDisplayGrade_Percentage(t *testing.T) {
	max := 100
	if got := ToDisplayGrade(85, &max, nil, Percentage); got != "85%" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(85, nil, nil, Percentage); got != "85" {
		t.Errorf("no max falls back: got %q", got)
	}
	zero := 0
	if got := ToDisplayGrade(85, &zero, nil, Percentage); got != "85" {
		t.Errorf("zero max: got %q", got)
	}
}

func TestToDisplayGrade_Letter(t *testing.T) {
	g4 := 4.0
	scale := &ParsedScale{Kind: Letter, LetterTiers: []LetterTier{
		{Label: "A", MinPct: 90, Gpa: &g4},
		{Label: "B", MinPct: 80, Gpa: nil},
		{Label: "F", MinPct: 0, Gpa: nil},
	}}
	max := 100
	if got := ToDisplayGrade(95, &max, scale, Letter); got != "A" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(85, &max, scale, Letter); got != "B" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(0, &max, scale, Letter); got != "F" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(95, &max, scale, Gpa); got != "4" {
		t.Errorf("gpa got %q", got)
	}
	// no max => fallback
	if got := ToDisplayGrade(95, nil, scale, Letter); got != "95" {
		t.Errorf("no max got %q", got)
	}
	// no scale => fallback
	if got := ToDisplayGrade(95, &max, nil, Letter); got != "95" {
		t.Errorf("no scale got %q", got)
	}
}

func TestToDisplayGrade_PassFail(t *testing.T) {
	max := 100
	scale := &ParsedScale{Kind: PassFail, PassMinPct: 60}
	if got := ToDisplayGrade(70, &max, scale, PassFail); got != "Pass" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(50, &max, scale, PassFail); got != "Fail" {
		t.Errorf("got %q", got)
	}
	// no max
	if got := ToDisplayGrade(1, nil, nil, PassFail); got != "Pass" {
		t.Errorf("no max pass got %q", got)
	}
	if got := ToDisplayGrade(0, nil, nil, PassFail); got != "Fail" {
		t.Errorf("no max fail got %q", got)
	}
	// no scale, with max
	if got := ToDisplayGrade(0, &max, nil, PassFail); got != "Fail" {
		t.Errorf("max no scale fail got %q", got)
	}
	if got := ToDisplayGrade(50, &max, nil, PassFail); got != "Pass" {
		t.Errorf("max no scale pass got %q", got)
	}
}

func TestToDisplayGrade_CompleteIncomplete(t *testing.T) {
	max := 100
	scale := &ParsedScale{Kind: CompleteIncomplete, CompleteMinPct: 50}
	if got := ToDisplayGrade(60, &max, scale, CompleteIncomplete); got != "Complete" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(40, &max, scale, CompleteIncomplete); got != "Incomplete" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(1, nil, nil, CompleteIncomplete); got != "Complete" {
		t.Errorf("no max got %q", got)
	}
	if got := ToDisplayGrade(0, nil, nil, CompleteIncomplete); got != "Incomplete" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(0, &max, nil, CompleteIncomplete); got != "Incomplete" {
		t.Errorf("got %q", got)
	}
	if got := ToDisplayGrade(60, &max, nil, CompleteIncomplete); got != "Complete" {
		t.Errorf("got %q", got)
	}
}
