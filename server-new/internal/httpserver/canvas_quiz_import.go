package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
)

// canvasImportQuizQuestions loads quiz questions from Canvas (paginated list + per-question
// fetch when answers are omitted) and maps them into the LMS module_quizzes JSON shape.
func canvasImportQuizQuestions(
	ctx context.Context,
	client *http.Client,
	canvasBase, accessToken string,
	canvasCourseID, canvasQuizID int64,
) ([]coursemodulequiz.QuizQuestion, error) {
	path := fmt.Sprintf("courses/%d/quizzes/%d/questions", canvasCourseID, canvasQuizID)
	rows, err := canvasGetArrayPaginated(ctx, client, canvasBase, accessToken, path, nil)
	if err != nil {
		return nil, err
	}
	sort.Slice(rows, func(i, j int) bool {
		return canvasQuestionPosition(rows[i]) < canvasQuestionPosition(rows[j])
	})
	out := make([]coursemodulequiz.QuizQuestion, 0, len(rows))
	for _, row := range rows {
		if len(out) >= coursemodulequiz.MaxQuizQuestions {
			break
		}
		qid := int64At(row, "id")
		if qid <= 0 {
			continue
		}
		if !canvasQuestionHasAnswers(row) {
			detailPath := fmt.Sprintf("courses/%d/quizzes/%d/questions/%d", canvasCourseID, canvasQuizID, qid)
			full, e := canvasGetObject(ctx, client, canvasBase, accessToken, detailPath, nil)
			if e == nil && full != nil {
				row = full
			}
		}
		if qq, ok := canvasQuestionToQuizQuestion(row); ok {
			out = append(out, qq)
		}
	}
	return out, nil
}

func canvasQuestionPosition(m map[string]any) float64 {
	if m == nil {
		return 0
	}
	switch v := m["position"].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return f
	default:
		return 0
	}
}

func canvasQuestionHasAnswers(m map[string]any) bool {
	raw, ok := m["answers"]
	if !ok || raw == nil {
		return false
	}
	arr, ok := raw.([]any)
	return ok && len(arr) > 0
}

func canvasAnswerMaps(q map[string]any) []map[string]any {
	raw, ok := q["answers"]
	if !ok || raw == nil {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(arr))
	for _, v := range arr {
		if m, ok := v.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func canvasAnswerText(a map[string]any) string {
	if a == nil {
		return ""
	}
	for _, k := range []string{"text", "answer_text", "html"} {
		if s := strAt(a, k, ""); s != "" {
			if k == "html" {
				return markdownFromHTML(s)
			}
			return markdownFromHTML(s)
		}
	}
	return ""
}

func canvasAnswerWeight(a map[string]any) float64 {
	if a == nil {
		return 0
	}
	switch v := a["weight"].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	default:
	}
	switch v := a["answer_weight"].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	default:
	}
	if s := strAt(a, "answer_weight", ""); s != "" {
		f, _ := strconv.ParseFloat(s, 64)
		return f
	}
	return 0
}

func canvasPointsPossibleI32(m map[string]any) int32 {
	if m == nil {
		return 1
	}
	var f float64
	switch v := m["points_possible"].(type) {
	case float64:
		f = v
	case int64:
		f = float64(v)
	case string:
		f, _ = strconv.ParseFloat(strings.TrimSpace(v), 64)
	default:
		f = 1
	}
	if f < 0 {
		return 0
	}
	// Round half away from zero behavior not critical; truncate toward zero for large values.
	if f > float64(coursemodulequiz.MaxItemPointsWorth) {
		return coursemodulequiz.MaxItemPointsWorth
	}
	return int32(f + 0.5)
}

func canvasQuestionToQuizQuestion(q map[string]any) (coursemodulequiz.QuizQuestion, bool) {
	id := int64At(q, "id")
	if id <= 0 {
		return coursemodulequiz.QuizQuestion{}, false
	}
	qtype := strAt(q, "question_type", "")
	if qtype == "" {
		return coursemodulequiz.QuizQuestion{}, false
	}
	promptHTML := strAt(q, "question_text", "")
	prompt := markdownFromHTML(promptHTML)
	if strings.TrimSpace(prompt) == "" {
		prompt = strAt(q, "question_name", "Question")
	}
	answers := canvasAnswerMaps(q)
	blankTC := json.RawMessage(`{}`)

	switch qtype {
	case "multiple_choice_question", "multiple_answers_question":
		choices := make([]string, 0, len(answers))
		answerToChoice := make([]int, len(answers)) // -1 if answer omitted from choices (empty label)
		for i := range answerToChoice {
			answerToChoice[i] = -1
		}
		for i, a := range answers {
			t := strings.TrimSpace(canvasAnswerText(a))
			if t == "" {
				continue
			}
			answerToChoice[i] = len(choices)
			choices = append(choices, t)
		}
		if len(choices) == 0 {
			return coursemodulequiz.QuizQuestion{
				ID:                 fmt.Sprintf("canvas-%d", id),
				Prompt:             prompt,
				QuestionType:       "essay",
				Choices:            nil,
				ChoiceIDs:          nil,
				TypeConfig:         blankTC,
				CorrectChoiceIndex: nil,
				MultipleAnswer:     false,
				AnswerWithImage:    false,
				Required:           true,
				Points:             canvasPointsPossibleI32(q),
				EstimatedMinutes:   2,
				SrsEligible:        false,
			}, true
		}
		bestAns := -1
		bestW := -1.0
		for i, a := range answers {
			w := canvasAnswerWeight(a)
			if w > bestW {
				bestW = w
				bestAns = i
			}
		}
		var corr *uint
		if bestAns >= 0 && bestW > 0 {
			if ci := answerToChoice[bestAns]; ci >= 0 {
				u := uint(ci)
				corr = &u
			}
		}
		return coursemodulequiz.QuizQuestion{
			ID:                 fmt.Sprintf("canvas-%d", id),
			Prompt:             prompt,
			QuestionType:       "multiple_choice",
			Choices:            choices,
			ChoiceIDs:          nil,
			TypeConfig:         blankTC,
			CorrectChoiceIndex: corr,
			MultipleAnswer:     qtype == "multiple_answers_question",
			AnswerWithImage:    false,
			Required:           true,
			Points:             canvasPointsPossibleI32(q),
			EstimatedMinutes:   2,
			SrsEligible:        false,
		}, true

	case "true_false_question":
		choices := []string{"True", "False"}
		corr := trueFalseCorrectChoiceIndex(answers)
		return coursemodulequiz.QuizQuestion{
			ID:                 fmt.Sprintf("canvas-%d", id),
			Prompt:             prompt,
			QuestionType:       "true_false",
			Choices:            choices,
			ChoiceIDs:          nil,
			TypeConfig:         blankTC,
			CorrectChoiceIndex: corr,
			MultipleAnswer:     false,
			AnswerWithImage:    false,
			Required:           true,
			Points:             canvasPointsPossibleI32(q),
			EstimatedMinutes:   1,
			SrsEligible:        false,
		}, true

	case "short_answer_question":
		return coursemodulequiz.QuizQuestion{
			ID:                 fmt.Sprintf("canvas-%d", id),
			Prompt:             prompt,
			QuestionType:       "short_answer",
			Choices:            nil,
			ChoiceIDs:          nil,
			TypeConfig:         blankTC,
			CorrectChoiceIndex: nil,
			MultipleAnswer:     false,
			AnswerWithImage:    false,
			Required:           true,
			Points:             canvasPointsPossibleI32(q),
			EstimatedMinutes:   3,
			SrsEligible:        false,
		}, true

	case "essay_question":
		return coursemodulequiz.QuizQuestion{
			ID:                 fmt.Sprintf("canvas-%d", id),
			Prompt:             prompt,
			QuestionType:       "essay",
			Choices:            nil,
			ChoiceIDs:          nil,
			TypeConfig:         blankTC,
			CorrectChoiceIndex: nil,
			MultipleAnswer:     false,
			AnswerWithImage:    false,
			Required:           true,
			Points:             canvasPointsPossibleI32(q),
			EstimatedMinutes:   10,
			SrsEligible:        false,
		}, true

	case "fill_in_multiple_blanks_question", "fill_in_blank_question":
		return coursemodulequiz.QuizQuestion{
			ID:                 fmt.Sprintf("canvas-%d", id),
			Prompt:             prompt,
			QuestionType:       "fill_in_blank",
			Choices:            nil,
			ChoiceIDs:          nil,
			TypeConfig:         blankTC,
			CorrectChoiceIndex: nil,
			MultipleAnswer:     false,
			AnswerWithImage:    false,
			Required:           true,
			Points:             canvasPointsPossibleI32(q),
			EstimatedMinutes:   3,
			SrsEligible:        false,
		}, true

	case "matching_question":
		pairs := canvasMatchingPairsJSON(answers)
		return coursemodulequiz.QuizQuestion{
			ID:                 fmt.Sprintf("canvas-%d", id),
			Prompt:             prompt,
			QuestionType:       "matching",
			Choices:            nil,
			ChoiceIDs:          nil,
			TypeConfig:         pairs,
			CorrectChoiceIndex: nil,
			MultipleAnswer:     false,
			AnswerWithImage:    false,
			Required:           true,
			Points:             canvasPointsPossibleI32(q),
			EstimatedMinutes:   5,
			SrsEligible:        false,
		}, true

	case "numerical_question":
		tc := canvasNumericTypeConfig(answers)
		return coursemodulequiz.QuizQuestion{
			ID:                 fmt.Sprintf("canvas-%d", id),
			Prompt:             prompt,
			QuestionType:       "numeric",
			Choices:            nil,
			ChoiceIDs:          nil,
			TypeConfig:         tc,
			CorrectChoiceIndex: nil,
			MultipleAnswer:     false,
			AnswerWithImage:    false,
			Required:           true,
			Points:             canvasPointsPossibleI32(q),
			EstimatedMinutes:   3,
			SrsEligible:        false,
		}, true

	default:
		note := fmt.Sprintf("%s\n\n_(Imported from Canvas as an essay: original type was `%s`.)_", prompt, qtype)
		return coursemodulequiz.QuizQuestion{
			ID:                 fmt.Sprintf("canvas-%d", id),
			Prompt:             note,
			QuestionType:       "essay",
			Choices:            nil,
			ChoiceIDs:          nil,
			TypeConfig:         blankTC,
			CorrectChoiceIndex: nil,
			MultipleAnswer:     false,
			AnswerWithImage:    false,
			Required:           true,
			Points:             canvasPointsPossibleI32(q),
			EstimatedMinutes:   10,
			SrsEligible:        false,
		}, true
	}
}

func trueFalseCorrectChoiceIndex(answers []map[string]any) *uint {
	for _, a := range answers {
		if canvasAnswerWeight(a) <= 0 {
			continue
		}
		t := strings.ToLower(strings.TrimSpace(canvasAnswerText(a)))
		if t == "" {
			continue
		}
		if strings.Contains(t, "true") && !strings.Contains(t, "false") {
			u := uint(0)
			return &u
		}
		if strings.Contains(t, "false") {
			u := uint(1)
			return &u
		}
	}
	// Fallback: first weighted answer index mapped onto [0,1] if there are exactly two answers.
	var idx int = -1
	for i, a := range answers {
		if canvasAnswerWeight(a) > 0 {
			idx = i
			break
		}
	}
	if idx >= 0 && len(answers) == 2 {
		u := uint(idx)
		if u <= 1 {
			return &u
		}
	}
	return nil
}

func canvasMatchingPairsJSON(answers []map[string]any) json.RawMessage {
	type pair struct {
		LeftID  string `json:"leftId"`
		RightID string `json:"rightId"`
		Left    string `json:"left"`
		Right   string `json:"right"`
	}
	ps := make([]pair, 0, len(answers))
	for i, a := range answers {
		left := strings.TrimSpace(strAt(a, "answer_match_left", ""))
		right := strings.TrimSpace(strAt(a, "answer_match_right", ""))
		if left == "" && right == "" {
			continue
		}
		ps = append(ps, pair{
			LeftID:  fmt.Sprintf("l%d", i),
			RightID: fmt.Sprintf("r%d", i),
			Left:    markdownFromHTML(left),
			Right:   markdownFromHTML(right),
		})
	}
	if len(ps) == 0 {
		return json.RawMessage(`{}`)
	}
	b, err := json.Marshal(map[string]any{"pairs": ps})
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(b)
}

func canvasNumericTypeConfig(answers []map[string]any) json.RawMessage {
	for _, a := range answers {
		if canvasAnswerWeight(a) <= 0 {
			continue
		}
		typ := strAt(a, "numerical_answer_type", "exact_answer")
		switch typ {
		case "range_answer":
			start, _ := a["start"].(float64)
			end, _ := a["end"].(float64)
			if start != 0 || end != 0 {
				mid := (start + end) / 2
				tol := (end - start) / 2
				if tol < 0 {
					tol = -tol
				}
				b, _ := json.Marshal(map[string]any{"correct": mid, "toleranceAbs": tol})
				return json.RawMessage(b)
			}
		case "precision_answer":
			if approx, ok := a["approximate"].(float64); ok {
				prec := 4.0
				if p, ok := a["precision"].(float64); ok && p > 0 {
					prec = p
				}
				b, _ := json.Marshal(map[string]any{"correct": approx, "tolerancePct": prec})
				return json.RawMessage(b)
			}
		default:
			if exact, ok := a["exact"].(float64); ok {
				margin := 0.0
				if m, ok := a["margin"].(float64); ok {
					margin = m
				}
				b, _ := json.Marshal(map[string]any{"correct": exact, "toleranceAbs": margin})
				return json.RawMessage(b)
			}
		}
	}
	return json.RawMessage(`{}`)
}
