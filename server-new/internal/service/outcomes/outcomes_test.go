package outcomes

import (
	"testing"

	"github.com/google/uuid"

	"github.com/lextures/lextures/server-new/internal/models/courseoutcomesapi"
	"github.com/lextures/lextures/server-new/internal/repos/courseoutcomes"
)

func TestValidateOutcomeLinkLevels_Defaults(t *testing.T) {
	m, i, err := ValidateOutcomeLinkLevels(nil, nil)
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
	if m != "formative" || i != "medium" {
		t.Fatalf("expected defaults, got m=%q i=%q", m, i)
	}
}

func TestValidateOutcomeLinkLevels_Invalid(t *testing.T) {
	bad := "nope"
	_, _, err := ValidateOutcomeLinkLevels(&bad, nil)
	if err == nil {
		t.Fatalf("expected error")
	}
}

func TestRollupAvgForOutcomeLinks_DedupesDuplicateEvidence(t *testing.T) {
	sid1 := uuid.MustParse("00000000-0000-0000-0000-0000000000a1")
	links := []courseoutcomesapi.CourseOutcomeLinkAPI{
		{
			StructureItemID: sid1,
			TargetKind:      "quiz",
			Progress:        courseoutcomes.ProgressToMapJSON(courseoutcomes.OutcomeLinkProgress{AvgScorePercent: ptrf32(80), GradedLearners: 1, EnrolledLearners: 1}),
		},
		{
			StructureItemID:  sid1,
			TargetKind:       "quiz",
			MeasurementLevel: "diagnostic",
			Progress:         courseoutcomes.ProgressToMapJSON(courseoutcomes.OutcomeLinkProgress{AvgScorePercent: ptrf32(20), GradedLearners: 1, EnrolledLearners: 1}),
		},
	}
	avg := RollupAvgForOutcomeLinks(links)
	if avg == nil {
		t.Fatalf("expected avg")
	}
	if *avg != 20 && *avg != 80 {
		t.Fatalf("expected deduped single score, got %v", *avg)
	}
}

func TestRollupAvgForOutcomeLinks_AveragesUniqueEvidence(t *testing.T) {
	sid1 := uuid.MustParse("00000000-0000-0000-0000-0000000000b1")
	sid2 := uuid.MustParse("00000000-0000-0000-0000-0000000000b2")
	links := []courseoutcomesapi.CourseOutcomeLinkAPI{
		{
			StructureItemID: sid1,
			TargetKind:      "quiz",
			Progress:        courseoutcomes.ProgressToMapJSON(courseoutcomes.OutcomeLinkProgress{AvgScorePercent: ptrf32(20), GradedLearners: 1, EnrolledLearners: 1}),
		},
		{
			StructureItemID: sid2,
			TargetKind:      "assignment",
			Progress:        courseoutcomes.ProgressToMapJSON(courseoutcomes.OutcomeLinkProgress{AvgScorePercent: ptrf32(40), GradedLearners: 1, EnrolledLearners: 1}),
		},
	}
	avg := RollupAvgForOutcomeLinks(links)
	if avg == nil {
		t.Fatalf("expected avg")
	}
	if *avg != 30 {
		t.Fatalf("expected 30, got %v", *avg)
	}
}

func ptrf32(v float32) *float32 { return &v }
