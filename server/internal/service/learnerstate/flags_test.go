package learnerstate

import (
	"testing"
)

func TestLearnerModelEnabled(t *testing.T) {
	cases := map[string]bool{
		"":      false,
		"0":     false,
		"false": false,
		"no":    false,
		"off":   false,
		"1":     true,
		"true":  true,
		"yes":   true,
		"on":    true,
		"TRUE":  true,
		" yes ": true,
	}
	for v, want := range cases {
		t.Setenv("ADAPTIVE_LEARNER_MODEL_ENABLED", v)
		if got := LearnerModelEnabled(); got != want {
			t.Errorf("%q: got %v want %v", v, got, want)
		}
	}
}

func TestLearnerModelEnabled_Unset(t *testing.T) {
	// no Setenv leaves whatever the parent env had — explicitly clear via Setenv to "" then check
	// but unset behavior is the empty-string lookup-not-ok branch. We cover ok branch above; here
	// we ensure default false even if explicitly "".
	t.Setenv("ADAPTIVE_LEARNER_MODEL_ENABLED", "")
	if LearnerModelEnabled() {
		t.Fatal("expected false for empty value")
	}
}

func TestLearnerEMAAlpha(t *testing.T) {
	t.Setenv("LEARNER_MODEL_EMA_ALPHA", "")
	if got := LearnerEMAAlpha(); got != 0.3 {
		t.Errorf("default got %v", got)
	}
	t.Setenv("LEARNER_MODEL_EMA_ALPHA", "0.5")
	if got := LearnerEMAAlpha(); got != 0.5 {
		t.Errorf("got %v", got)
	}
	t.Setenv("LEARNER_MODEL_EMA_ALPHA", "1")
	if got := LearnerEMAAlpha(); got != 1 {
		t.Errorf("got %v", got)
	}
	t.Setenv("LEARNER_MODEL_EMA_ALPHA", "junk")
	if got := LearnerEMAAlpha(); got != 0.3 {
		t.Errorf("invalid -> default, got %v", got)
	}
	t.Setenv("LEARNER_MODEL_EMA_ALPHA", "0")
	if got := LearnerEMAAlpha(); got != 0.3 {
		t.Errorf("zero -> default, got %v", got)
	}
	t.Setenv("LEARNER_MODEL_EMA_ALPHA", "1.5")
	if got := LearnerEMAAlpha(); got != 0.3 {
		t.Errorf(">1 -> default, got %v", got)
	}
	t.Setenv("LEARNER_MODEL_EMA_ALPHA", "-0.1")
	if got := LearnerEMAAlpha(); got != 0.3 {
		t.Errorf("neg -> default, got %v", got)
	}
}
