package questionbank

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/lextures/lextures/server/internal/models/coursemodulequiz"
)

func TestRefsUsePool(t *testing.T) {
	pid := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	if RefsUsePool([]QuizQuestionRefRow{{QuestionID: ptrUUID(uuid.New())}}) {
		t.Fatal("fixed ref should not use pool")
	}
	if !RefsUsePool([]QuizQuestionRefRow{{PoolID: &pid}}) {
		t.Fatal("pool ref expected")
	}
}

func ptrUUID(u uuid.UUID) *uuid.UUID { return &u }

func TestHasExtendedQuizTypes(t *testing.T) {
	if hasExtendedQuizTypes([]coursemodulequiz.QuizQuestion{{QuestionType: "multiple_choice"}}) {
		t.Fatal()
	}
	if !hasExtendedQuizTypes([]coursemodulequiz.QuizQuestion{{QuestionType: "matching"}}) {
		t.Fatal()
	}
}

func TestQuizQuestionFromEntity(t *testing.T) {
	opts, _ := json.Marshal([]map[string]any{{"id": "11111111-1111-1111-1111-111111111111", "text": "A"}, {"text": "B"}})
	corr, _ := json.Marshal(map[string]any{"correctChoiceIndex": 0})
	e := &QuestionEntity{
		ID:            uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		CourseID:      uuid.MustParse("33333333-3333-3333-3333-333333333333"),
		QuestionType:  "mc_single",
		Stem:          "Q?",
		Options:       opts,
		CorrectAnswer: corr,
		Points:        2.5,
		VersionNumber: 1,
		SRSEligible:   true,
	}
	q, err := QuizQuestionFromEntity(e)
	if err != nil {
		t.Fatal(err)
	}
	if q.Prompt != "Q?" || len(q.Choices) != 2 || q.Points != 3 {
		t.Fatalf("unexpected: %+v", q)
	}
	if q.CorrectChoiceIndex == nil || *q.CorrectChoiceIndex != 0 {
		t.Fatalf("correct idx: %+v", q.CorrectChoiceIndex)
	}
}

func TestCloneQuestions(t *testing.T) {
	idx := uint(1)
	src := []coursemodulequiz.QuizQuestion{{
		Choices: []string{"a"}, ChoiceIDs: []string{"x"}, TypeConfig: []byte(`{}`), CorrectChoiceIndex: &idx,
	}}
	out := cloneQuestions(src)
	out[0].CorrectChoiceIndex = nil
	if src[0].CorrectChoiceIndex == nil {
		t.Fatal("source should keep correct index")
	}
}
