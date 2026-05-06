package coursemodulesurvey

import "testing"

func TestValidateAnonymityMode(t *testing.T) {
	for _, m := range []string{"identified", "anonymous", "pseudo_anonymous"} {
		if !ValidateAnonymityMode(m) {
			t.Errorf("expected %q valid", m)
		}
	}
	for _, m := range []string{"", "other", "anon"} {
		if ValidateAnonymityMode(m) {
			t.Errorf("expected %q invalid", m)
		}
	}
}

func TestValidateQuestions_OK(t *testing.T) {
	qs := []SurveyQuestion{
		{ID: "q1", Subtype: "likert", Stem: "How are you?"},
		{ID: "q2", Subtype: "free_text", Stem: "Why?"},
	}
	if err := ValidateQuestions(qs); err != nil {
		t.Fatal(err)
	}
}

func TestValidateQuestions_Errors(t *testing.T) {
	cases := []struct {
		name string
		qs   []SurveyQuestion
	}{
		{"missing id", []SurveyQuestion{{Subtype: "likert", Stem: "x"}}},
		{"missing stem", []SurveyQuestion{{ID: "q", Subtype: "likert"}}},
		{"bad subtype", []SurveyQuestion{{ID: "q", Subtype: "weird", Stem: "x"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := ValidateQuestions(c.qs); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestValidateQuestions_TooMany(t *testing.T) {
	qs := make([]SurveyQuestion, 201)
	for i := range qs {
		qs[i] = SurveyQuestion{ID: "q", Subtype: "likert", Stem: "s"}
	}
	if err := ValidateQuestions(qs); err == nil {
		t.Fatal("expected too many error")
	}
}

func TestValidateQuestions_AllSubtypes(t *testing.T) {
	for _, sub := range SurveyQuestionTypes {
		q := []SurveyQuestion{{ID: "q", Subtype: sub, Stem: "s"}}
		if err := ValidateQuestions(q); err != nil {
			t.Errorf("subtype %q: %v", sub, err)
		}
	}
}
