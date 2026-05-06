package quizattemptgrading

import (
	"math"
	"testing"

	"github.com/lextures/lextures/server/internal/models/coursemodulequiz"
)

func uptr(u uint) *uint     { return &u }
func i32ptr(i int32) *int32 { return &i }

func TestAdaptiveTurnIsCorrect(t *testing.T) {
	if AdaptiveTurnIsCorrect(nil) {
		t.Fatal("nil")
	}
	if AdaptiveTurnIsCorrect(&coursemodulequiz.AdaptiveQuizHistoryTurn{}) {
		t.Fatal("empty weights")
	}
	if AdaptiveTurnIsCorrect(&coursemodulequiz.AdaptiveQuizHistoryTurn{
		ChoiceWeights: []float64{0, 1},
	}) {
		t.Fatal("nil sel")
	}
	if AdaptiveTurnIsCorrect(&coursemodulequiz.AdaptiveQuizHistoryTurn{
		ChoiceWeights: []float64{0, 1}, SelectedChoiceIndex: uptr(99),
	}) {
		t.Fatal("oob")
	}
	if !AdaptiveTurnIsCorrect(&coursemodulequiz.AdaptiveQuizHistoryTurn{
		ChoiceWeights: []float64{0, 1}, SelectedChoiceIndex: uptr(1),
	}) {
		t.Fatal("correct")
	}
	if AdaptiveTurnIsCorrect(&coursemodulequiz.AdaptiveQuizHistoryTurn{
		ChoiceWeights: []float64{0, 1}, SelectedChoiceIndex: uptr(0),
	}) {
		t.Fatal("wrong")
	}
	if AdaptiveTurnIsCorrect(&coursemodulequiz.AdaptiveQuizHistoryTurn{
		ChoiceWeights: []float64{math.NaN(), 1}, SelectedChoiceIndex: uptr(1),
	}) {
		t.Fatal("nan")
	}
	if AdaptiveTurnIsCorrect(&coursemodulequiz.AdaptiveQuizHistoryTurn{
		ChoiceWeights: []float64{math.Inf(1), 1}, SelectedChoiceIndex: uptr(0),
	}) {
		t.Fatal("inf")
	}
	if !AdaptiveTurnIsCorrect(&coursemodulequiz.AdaptiveQuizHistoryTurn{
		ChoiceWeights: []float64{1, 1, 1}, SelectedChoiceIndex: uptr(2),
	}) {
		t.Fatal("tied max")
	}
}

func TestAdaptiveTurnMaxPoints(t *testing.T) {
	if AdaptiveTurnMaxPoints(nil) != 0 {
		t.Fatal("nil")
	}
	if AdaptiveTurnMaxPoints(&coursemodulequiz.AdaptiveQuizHistoryTurn{}) != 1 {
		t.Fatal("default 1")
	}
	if AdaptiveTurnMaxPoints(&coursemodulequiz.AdaptiveQuizHistoryTurn{Points: i32ptr(5)}) != 5 {
		t.Fatal("5")
	}
	if AdaptiveTurnMaxPoints(&coursemodulequiz.AdaptiveQuizHistoryTurn{Points: i32ptr(-3)}) != 0 {
		t.Fatal("neg -> 0")
	}
}
