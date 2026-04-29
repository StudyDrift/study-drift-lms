package coursemodulequiz

import (
	"encoding/json"
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

func TestSanitizeQuizQuestionsForLearner_typeConfigIsDeepCopy(t *testing.T) {
	in := []QuizQuestion{{
		ID:           "q1",
		TypeConfig:   json.RawMessage(`{"a":1}`),
		Choices:      []string{"x"},
		ChoiceIDs:    []string{"1"},
		ConceptIDs:   []string{"c1"},
		QuestionType: "mc_single",
	}}
	out := SanitizeQuizQuestionsForLearner(in)
	if len(out) != 1 {
		t.Fatalf("len: %d", len(out))
	}
	out[0].TypeConfig[0] = '0'
	if string(in[0].TypeConfig) != `{"a":1}` {
		t.Fatalf("mutating learner copy must not change stored question bytes; got %q", in[0].TypeConfig)
	}
}
