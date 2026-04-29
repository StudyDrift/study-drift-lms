package coursemodulequiz

import (
	"testing"
)

func TestSanitizeQuizQuestionsForLearner(t *testing.T) {
	idx := uint(2)
	in := []QuizQuestion{{ID: "1", CorrectChoiceIndex: &idx, Choices: []string{"x"}}}
	out := SanitizeQuizQuestionsForLearner(in)
	if out[0].CorrectChoiceIndex != nil {
		t.Fatal("expected stripped")
	}
	if in[0].CorrectChoiceIndex == nil {
		t.Fatal("input unchanged")
	}
	if len(out[0].Choices) != 1 || out[0].Choices[0] != "x" {
		t.Fatalf("choices: %#v", out[0].Choices)
	}
}
