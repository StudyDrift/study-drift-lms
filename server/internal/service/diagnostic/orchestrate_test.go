package diagnostic

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/repos/questionbank"
)

func TestIsCalibrated(t *testing.T) {
	a, b := 0.5, 0.0
	cases := []struct {
		name string
		ent  *questionbank.QuestionEntity
		want bool
	}{
		{"nil", nil, false},
		{
			"ok",
			&questionbank.QuestionEntity{IrtStatus: "calibrated", IrtA: &a, IrtB: &b},
			true,
		},
		{
			"low_a",
			&questionbank.QuestionEntity{IrtStatus: "calibrated", IrtA: ptr(0.001), IrtB: &b},
			false,
		},
		{
			"wrong_status",
			&questionbank.QuestionEntity{IrtStatus: "pending", IrtA: &a, IrtB: &b},
			false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isCalibrated(c.ent); got != c.want {
				t.Fatalf("got %v want %v", got, c.want)
			}
		})
	}
}

func ptr(f float64) *float64 { return &f }

func TestBankAnswerIsCorrect(t *testing.T) {
	True := true
	False := false
	idx2 := []byte(`{"index":2}`)
	if !bankAnswerIsCorrect(
		&questionbank.QuestionEntity{QuestionType: "true_false", CorrectAnswer: mustJSON(t, True)},
		0,
	) {
		t.Fatal("true_false")
	}
	if bankAnswerIsCorrect(
		&questionbank.QuestionEntity{QuestionType: "true_false", CorrectAnswer: mustJSON(t, True)},
		1,
	) {
		t.Fatal("true_false mismatch")
	}
	if !bankAnswerIsCorrect(
		&questionbank.QuestionEntity{QuestionType: "true_false", CorrectAnswer: mustJSON(t, False)},
		1,
	) {
		t.Fatal("false as correct")
	}
	if !bankAnswerIsCorrect(
		&questionbank.QuestionEntity{QuestionType: "mc_single", CorrectAnswer: idx2},
		2,
	) {
		t.Fatal("mc index")
	}
	if bankAnswerIsCorrect(
		&questionbank.QuestionEntity{QuestionType: "other"},
		0,
	) {
		t.Fatal("other type")
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestConceptsForEntity(t *testing.T) {
	c1 := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	c2 := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	qid := uuid.MustParse("00000000-0000-0000-0000-0000000000aa")
	diag := []uuid.UUID{c1, c2}

	// Tag map takes precedence
	tagMap := map[uuid.UUID][]uuid.UUID{qid: {c1}}
	if got := conceptsForEntity(
		&questionbank.QuestionEntity{ID: qid, Metadata: []byte(`{"conceptIds":["` + c2.String() + `"]}`)},
		tagMap,
		diag,
	); len(got) != 1 || got[0] != c1 {
		t.Fatalf("tag wins: %v", got)
	}

	q2 := uuid.MustParse("00000000-0000-0000-0000-0000000000cc")
	if got := conceptsForEntity(
		&questionbank.QuestionEntity{ID: q2, Metadata: []byte(`{"conceptIds":["` + c2.String() + `"]}`)},
		nil,
		diag,
	); len(got) != 1 || got[0] != c2 {
		t.Fatalf("meta: %v", got)
	}
	emptyQ := uuid.MustParse("00000000-0000-0000-0000-0000000000bb")
	if got := conceptsForEntity(
		&questionbank.QuestionEntity{ID: emptyQ, Metadata: []byte(`{}`)},
		nil,
		diag,
	); len(got) != 1 || got[0] != c1 {
		t.Fatalf("fallback: %v", got)
	}
}

func TestPlacementItemFromRules(t *testing.T) {
	fb := uuid.MustParse("00000000-0000-0000-0000-0000000000fa")
	c1 := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	start1 := uuid.MustParse("00000000-0000-0000-0000-0000000000a1")
	if got := placementItemFromRules([]byte("not-json"), nil, fb); got != fb {
		t.Fatalf("invalid json: %v", got)
	}
	raw, _ := json.Marshal([]map[string]any{{
		"conceptId":    c1.String(),
		"masteryBelow": 0.5,
		"startItemId":  start1.String(),
	}})
	if got := placementItemFromRules(raw, map[uuid.UUID]float64{c1: 0.3}, fb); got != start1 {
		t.Fatalf("rule: %v", got)
	}
}

func TestShouldFinishDiagnostic(t *testing.T) {
	if !shouldFinishDiagnostic(5, 5, "se_threshold", 0.2, 0.1) {
		t.Fatal("max items")
	}
	if shouldFinishDiagnostic(1, 10, "se_threshold", 0.2, 0.1) {
		t.Fatal("min answered")
	}
	if !shouldFinishDiagnostic(5, 10, "se_threshold", 0.2, 0.1) {
		t.Fatal("se")
	}
	if shouldFinishDiagnostic(5, 10, "off", 0.2, 0.1) {
		t.Fatal("off")
	}
}

func TestParseThetaCuts(t *testing.T) {
	if parseThetaCuts(nil) != nil {
		t.Fatal("nil")
	}
	if parseThetaCuts([]byte(`[0,1]`)) != nil {
		t.Fatal("short")
	}
	if c := parseThetaCuts([]byte(`[-0.5,0,0.5]`)); c == nil || (*c)[0] != -0.5 {
		t.Fatalf("ok: %v", c)
	}
}

func TestThetaToMastery(t *testing.T) {
	if m := thetaToMastery(0.0); math.Abs(m-0.5) > 1e-6 {
		t.Fatalf("mid: %v", m)
	}
}

func TestProficiencyForTheta(t *testing.T) {
	k, lab := proficiencyForTheta(-2.0, nil)
	if k != "diagnostic.proficiency.beginner" || lab != "Beginner" {
		t.Fatalf("beginner: %s %s", k, lab)
	}
}
