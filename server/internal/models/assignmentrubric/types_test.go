package assignmentrubric

import (
	"math"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func sptr(s string) *string { return &s }
func iptr(i int32) *int32   { return &i }

func validRubric() *RubricDefinition {
	return &RubricDefinition{
		Title: sptr("Rubric"),
		Criteria: []RubricCriterion{
			{
				ID:    uuid.New(),
				Title: "Quality",
				Levels: []RubricLevel{
					{Label: "Bad", Points: 0},
					{Label: "Good", Points: 5},
					{Label: "Great", Points: 10},
				},
			},
		},
	}
}

func TestValidateRubricDefinition_Valid(t *testing.T) {
	if err := ValidateRubricDefinition(validRubric()); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRubricDefinition_NilAndEmpty(t *testing.T) {
	if err := ValidateRubricDefinition(nil); err == nil {
		t.Fatal("nil")
	}
	r := &RubricDefinition{}
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("empty criteria")
	}
}

func TestValidateRubricDefinition_TitleBounds(t *testing.T) {
	r := validRubric()
	r.Title = sptr("")
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("empty title")
	}
	r.Title = sptr(strings.Repeat("a", MaxTitleLen+1))
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("long title")
	}
	r.Title = nil
	if err := ValidateRubricDefinition(r); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRubricDefinition_TooManyCriteria(t *testing.T) {
	r := validRubric()
	base := r.Criteria[0]
	for i := 0; i < MaxCriteria; i++ {
		c := base
		c.ID = uuid.New()
		r.Criteria = append(r.Criteria, c)
	}
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("expected too many criteria")
	}
}

func TestValidateRubricDefinition_DuplicateIDs(t *testing.T) {
	r := validRubric()
	c2 := r.Criteria[0]
	r.Criteria = append(r.Criteria, c2)
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("dup ids")
	}
}

func TestValidateRubricDefinition_BadCriterion(t *testing.T) {
	r := validRubric()
	r.Criteria[0].Title = ""
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("empty crit title")
	}
	r = validRubric()
	r.Criteria[0].Title = strings.Repeat("a", MaxTitleLen+1)
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("long crit title")
	}
	r = validRubric()
	r.Criteria[0].Description = sptr(strings.Repeat("a", MaxDescLen+1))
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("long desc")
	}
	r = validRubric()
	r.Criteria[0].Levels = nil
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("no levels")
	}
}

func TestValidateRubricDefinition_BadLevel(t *testing.T) {
	r := validRubric()
	r.Criteria[0].Levels[0].Label = ""
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("empty label")
	}
	r = validRubric()
	r.Criteria[0].Levels[0].Label = strings.Repeat("a", MaxLevelLabelLen+1)
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("long label")
	}
	r = validRubric()
	r.Criteria[0].Levels[0].Description = sptr(strings.Repeat("a", MaxLevelDescLen+1))
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("long lvl desc")
	}
	r = validRubric()
	r.Criteria[0].Levels[0].Points = math.NaN()
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("nan points")
	}
	r = validRubric()
	r.Criteria[0].Levels[0].Points = -1
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("neg points")
	}
	r = validRubric()
	r.Criteria[0].Levels[0].Points = math.Inf(1)
	if err := ValidateRubricDefinition(r); err == nil {
		t.Fatal("inf points")
	}
}

func TestValidateRubricAgainstPointsWorth(t *testing.T) {
	r := validRubric()
	if err := ValidateRubricAgainstPointsWorth(r, nil); err != nil {
		t.Fatal("nil pw")
	}
	zero := int32(0)
	if err := ValidateRubricAgainstPointsWorth(r, &zero); err != nil {
		t.Fatal("zero pw")
	}
	good := int32(10)
	if err := ValidateRubricAgainstPointsWorth(r, &good); err != nil {
		t.Fatal(err)
	}
	if err := ValidateRubricAgainstPointsWorth(r, iptr(7)); err == nil {
		t.Fatal("mismatch")
	}
}

func TestValidateRubricScoresForGrade(t *testing.T) {
	r := validRubric()
	cid := r.Criteria[0].ID
	total, err := ValidateRubricScoresForGrade(r, map[uuid.UUID]float64{cid: 5})
	if err != nil || total != 5 {
		t.Fatalf("total=%v err=%v", total, err)
	}
	if _, err := ValidateRubricScoresForGrade(r, map[uuid.UUID]float64{}); err == nil {
		t.Fatal("missing")
	}
	if _, err := ValidateRubricScoresForGrade(r, map[uuid.UUID]float64{cid: 7}); err == nil {
		t.Fatal("not on level")
	}
	if _, err := ValidateRubricScoresForGrade(r, map[uuid.UUID]float64{cid: 5, uuid.New(): 1}); err == nil {
		t.Fatal("extra criterion")
	}
}
