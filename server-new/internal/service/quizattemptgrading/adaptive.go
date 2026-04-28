// Adaptive and CAT scoring helpers (port of the top of server/src/services/quiz_attempt_grading.rs).
package quizattemptgrading

import (
	"math"

	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
)

// AdaptiveTurnIsCorrect is true when the selected choice ties for the max choice weight.
func AdaptiveTurnIsCorrect(turn *coursemodulequiz.AdaptiveQuizHistoryTurn) bool {
	if turn == nil {
		return false
	}
	weights := turn.ChoiceWeights
	if len(weights) == 0 {
		return false
	}
	if turn.SelectedChoiceIndex == nil {
		return false
	}
	sel := int(*turn.SelectedChoiceIndex)
	if sel < 0 || sel >= len(weights) {
		return false
	}
	maxW := weights[0]
	for _, w := range weights[1:] {
		if w > maxW {
			maxW = w
		}
	}
	if math.IsNaN(maxW) || math.IsInf(maxW, 0) {
		return false
	}
	w := weights[sel]
	return math.Abs(w-maxW) < 1e-9 || w >= maxW-1e-9
}

// AdaptiveTurnMaxPoints returns non-negative point ceiling for a history turn.
func AdaptiveTurnMaxPoints(turn *coursemodulequiz.AdaptiveQuizHistoryTurn) float64 {
	if turn == nil {
		return 0
	}
	p := int32(1)
	if turn.Points != nil {
		p = *turn.Points
	}
	if p < 0 {
		return 0
	}
	return float64(p)
}
