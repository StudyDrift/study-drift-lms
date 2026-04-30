package adaptivequizcat

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/lextures/lextures/server/internal/models/coursemodulequiz"
	"github.com/lextures/lextures/server/internal/repos/questionbank"
)

// BankEntityToAdaptiveQuestion converts a bank row to the adaptive quiz wire shape (Rust `bank_entity_to_adaptive_question`).
func BankEntityToAdaptiveQuestion(e *questionbank.QuestionEntity) (coursemodulequiz.AdaptiveQuizGeneratedQuestion, error) {
	if e == nil {
		return coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("nil question entity")
	}
	qt := e.QuestionType
	switch qt {
	case "true_false":
		correct := false
		if e.CorrectAnswer != nil {
			_ = json.Unmarshal(e.CorrectAnswer, &correct)
		}
		choices := []string{"True", "False"}
		w := []float64{0, 0}
		if correct {
			w[0] = 1
		} else {
			w[1] = 1
		}
		qid := e.ID
		return coursemodulequiz.AdaptiveQuizGeneratedQuestion{
			QuestionID:       &qid,
			Prompt:           e.Stem,
			QuestionType:     "true_false",
			Choices:          choices,
			ChoiceWeights:    w,
			MultipleAnswer:   false,
			AnswerWithImage:  false,
			Required:         true,
			Points:           int32(math.Round(e.Points)),
			EstimatedMinutes: 2,
		}, nil
	case "mc_single", "mc_multiple":
		var opts []json.RawMessage
		if e.Options != nil {
			if err := json.Unmarshal(e.Options, &opts); err != nil {
				return coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("bank question options: %w", err)
			}
		}
		choices := make([]string, 0, len(opts))
		for _, raw := range opts {
			var s string
			if err := json.Unmarshal(raw, &s); err != nil {
				continue
			}
			choices = append(choices, s)
		}
		if len(choices) == 0 {
			return coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("bank question options are empty for adaptive CAT")
		}
		correctIdx := 0
		if e.CorrectAnswer != nil {
			var obj struct {
				Index uint64 `json:"index"`
			}
			if err := json.Unmarshal(e.CorrectAnswer, &obj); err == nil && int(obj.Index) < len(choices) {
				correctIdx = int(obj.Index)
			}
		}
		w := make([]float64, len(choices))
		if correctIdx >= 0 && correctIdx < len(w) {
			w[correctIdx] = 1
		}
		qid := e.ID
		return coursemodulequiz.AdaptiveQuizGeneratedQuestion{
			QuestionID:       &qid,
			Prompt:           e.Stem,
			QuestionType:     "multiple_choice",
			Choices:          choices,
			ChoiceWeights:    w,
			MultipleAnswer:   qt == "mc_multiple",
			AnswerWithImage:  false,
			Required:         true,
			Points:           int32(math.Round(e.Points)),
			EstimatedMinutes: 2,
		}, nil
	default:
		return coursemodulequiz.AdaptiveQuizGeneratedQuestion{}, fmt.Errorf("question type %q is not supported for IRT CAT in this version", qt)
	}
}
