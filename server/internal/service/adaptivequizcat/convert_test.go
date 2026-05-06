package adaptivequizcat

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/repos/questionbank"
)

func TestBankEntityToAdaptiveQuestion_Nil(t *testing.T) {
	if _, err := BankEntityToAdaptiveQuestion(nil); err == nil {
		t.Fatal("expected error")
	}
}

func TestBankEntityToAdaptiveQuestion_TrueFalse(t *testing.T) {
	e := &questionbank.QuestionEntity{
		ID: uuid.New(), QuestionType: "true_false",
		Stem: "Is sky blue?", Points: 3.4,
		CorrectAnswer: json.RawMessage(`true`),
	}
	q, err := BankEntityToAdaptiveQuestion(e)
	if err != nil {
		t.Fatal(err)
	}
	if q.QuestionType != "true_false" || len(q.Choices) != 2 {
		t.Fatalf("%+v", q)
	}
	if q.ChoiceWeights[0] != 1 || q.ChoiceWeights[1] != 0 {
		t.Fatalf("weights for true: %v", q.ChoiceWeights)
	}
	if q.Points != 3 {
		t.Fatalf("rounded points: %d", q.Points)
	}
}

func TestBankEntityToAdaptiveQuestion_TrueFalse_FalseAnswer(t *testing.T) {
	e := &questionbank.QuestionEntity{
		ID: uuid.New(), QuestionType: "true_false",
		Stem: "x", Points: 1, CorrectAnswer: json.RawMessage(`false`),
	}
	q, err := BankEntityToAdaptiveQuestion(e)
	if err != nil {
		t.Fatal(err)
	}
	if q.ChoiceWeights[1] != 1 {
		t.Fatalf("expected false weight: %v", q.ChoiceWeights)
	}
}

func TestBankEntityToAdaptiveQuestion_TrueFalse_NilAnswer(t *testing.T) {
	e := &questionbank.QuestionEntity{
		ID: uuid.New(), QuestionType: "true_false", Stem: "x", Points: 1,
	}
	q, err := BankEntityToAdaptiveQuestion(e)
	if err != nil || q.ChoiceWeights[1] != 1 {
		t.Fatalf("default-false: %v err=%v", q.ChoiceWeights, err)
	}
}

func TestBankEntityToAdaptiveQuestion_MCSingle(t *testing.T) {
	e := &questionbank.QuestionEntity{
		ID: uuid.New(), QuestionType: "mc_single", Stem: "Pick", Points: 5,
		Options:       json.RawMessage(`["a","b","c"]`),
		CorrectAnswer: json.RawMessage(`{"index":2}`),
	}
	q, err := BankEntityToAdaptiveQuestion(e)
	if err != nil {
		t.Fatal(err)
	}
	if q.QuestionType != "multiple_choice" || len(q.Choices) != 3 || q.ChoiceWeights[2] != 1 {
		t.Fatalf("%+v", q)
	}
	if q.MultipleAnswer {
		t.Fatal("single")
	}
}

func TestBankEntityToAdaptiveQuestion_MCMultiple(t *testing.T) {
	e := &questionbank.QuestionEntity{
		ID: uuid.New(), QuestionType: "mc_multiple", Stem: "Pick", Points: 1,
		Options: json.RawMessage(`["a","b"]`),
	}
	q, err := BankEntityToAdaptiveQuestion(e)
	if err != nil || !q.MultipleAnswer {
		t.Fatal()
	}
}

func TestBankEntityToAdaptiveQuestion_MC_BadOptions(t *testing.T) {
	e := &questionbank.QuestionEntity{
		ID: uuid.New(), QuestionType: "mc_single", Stem: "x",
		Options: json.RawMessage(`{"bad":1}`),
	}
	if _, err := BankEntityToAdaptiveQuestion(e); err == nil {
		t.Fatal("expected error parsing options")
	}
}

func TestBankEntityToAdaptiveQuestion_MC_EmptyOptions(t *testing.T) {
	e := &questionbank.QuestionEntity{
		ID: uuid.New(), QuestionType: "mc_single", Stem: "x",
		Options: json.RawMessage(`[]`),
	}
	if _, err := BankEntityToAdaptiveQuestion(e); err == nil {
		t.Fatal("expected error on empty")
	}
}

func TestBankEntityToAdaptiveQuestion_MC_OutOfRangeIndex(t *testing.T) {
	e := &questionbank.QuestionEntity{
		ID: uuid.New(), QuestionType: "mc_single", Stem: "x", Points: 1,
		Options:       json.RawMessage(`["a","b"]`),
		CorrectAnswer: json.RawMessage(`{"index":99}`),
	}
	q, err := BankEntityToAdaptiveQuestion(e)
	if err != nil {
		t.Fatal(err)
	}
	// out-of-range index falls through to default 0
	if q.ChoiceWeights[0] != 1 {
		t.Fatalf("weights: %v", q.ChoiceWeights)
	}
}

func TestBankEntityToAdaptiveQuestion_Unsupported(t *testing.T) {
	e := &questionbank.QuestionEntity{ID: uuid.New(), QuestionType: "essay"}
	if _, err := BankEntityToAdaptiveQuestion(e); err == nil {
		t.Fatal("expected error")
	}
}
