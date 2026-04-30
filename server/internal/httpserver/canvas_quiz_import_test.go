package httpserver

import (
	"encoding/json"
	"testing"
)

func TestCanvasQuestionToQuizQuestion_MultipleChoice(t *testing.T) {
	q := map[string]any{
		"id":              float64(42),
		"question_type":   "multiple_choice_question",
		"question_text":   "<p>Pick one</p>",
		"points_possible": float64(2),
		"answers": []any{
			map[string]any{"text": "A", "weight": float64(0)},
			map[string]any{"text": "B", "weight": float64(100)},
		},
	}
	qq, ok := canvasQuestionToQuizQuestion(q)
	if !ok {
		t.Fatal("expected ok")
	}
	if qq.ID != "canvas-42" || qq.QuestionType != "multiple_choice" {
		t.Fatalf("unexpected: %+v", qq)
	}
	if len(qq.Choices) != 2 || qq.Choices[1] != "B" {
		t.Fatalf("choices: %#v", qq.Choices)
	}
	if qq.CorrectChoiceIndex == nil || *qq.CorrectChoiceIndex != 1 {
		t.Fatalf("correct index: %v", qq.CorrectChoiceIndex)
	}
	if qq.Points != 2 {
		t.Fatalf("points: %d", qq.Points)
	}
}

func TestCanvasQuestionToQuizQuestion_TrueFalseSecondAnswerCorrect(t *testing.T) {
	q := map[string]any{
		"id":              float64(7),
		"question_type":   "true_false_question",
		"question_text":   "",
		"question_name":   "TF",
		"points_possible": float64(1),
		"answers": []any{
			map[string]any{"text": "False", "weight": float64(0)},
			map[string]any{"text": "True", "weight": float64(100)},
		},
	}
	qq, ok := canvasQuestionToQuizQuestion(q)
	if !ok {
		t.Fatal("expected ok")
	}
	if qq.QuestionType != "true_false" || len(qq.Choices) != 2 {
		t.Fatalf("unexpected: %+v", qq)
	}
	if qq.CorrectChoiceIndex == nil || *qq.CorrectChoiceIndex != 0 {
		t.Fatalf("want True (index 0), got %v", qq.CorrectChoiceIndex)
	}
}

func TestCanvasMatchingPairsJSON(t *testing.T) {
	answers := []map[string]any{
		{"answer_match_left": "A", "answer_match_right": "1", "weight": float64(100)},
	}
	raw := canvasMatchingPairsJSON(answers)
	var wrap struct {
		Pairs []struct {
			LeftID  string `json:"leftId"`
			RightID string `json:"rightId"`
			Left    string `json:"left"`
			Right   string `json:"right"`
		} `json:"pairs"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		t.Fatal(err)
	}
	if len(wrap.Pairs) != 1 || wrap.Pairs[0].LeftID != "l0" || wrap.Pairs[0].RightID != "r0" {
		t.Fatalf("%+v", wrap)
	}
}
