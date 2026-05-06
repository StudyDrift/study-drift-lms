package gradingdrops

import (
	"math"
	"testing"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/repos/coursegrading"
)

func TestGroupPoliciesFromSettings(t *testing.T) {
	g1 := uuid.New()
	g2 := uuid.New()
	groups := []coursegrading.AssignmentGroupPublic{
		{ID: g1, DropLowest: 2, DropHighest: 1, ReplaceLowestWithFinal: true},
		{ID: g2, DropLowest: -3, DropHighest: -5, ReplaceLowestWithFinal: false},
	}
	out := GroupPoliciesFromSettings(groups)
	if out[g1].DropLowest != 2 || out[g1].DropHighest != 1 || !out[g1].ReplaceLowestWithFinal {
		t.Fatalf("g1: %+v", out[g1])
	}
	if out[g2].DropLowest != 0 || out[g2].DropHighest != 0 {
		t.Fatalf("expected negatives clamped to 0: %+v", out[g2])
	}
}

func TestItemDropsForLearner_BasicDrop(t *testing.T) {
	gid := uuid.New()
	a := uuid.New()
	b := uuid.New()
	c := uuid.New()
	policies := map[uuid.UUID]GroupDropPolicy{
		gid: {DropLowest: 1},
	}
	cols := []ColMeta{
		{ID: a, GroupID: &gid, Max: 100},
		{ID: b, GroupID: &gid, Max: 100},
		{ID: c, GroupID: &gid, Max: 100},
	}
	earned := map[uuid.UUID]float64{a: 50, b: 90, c: 80}
	got := ItemDropsForLearner(policies, cols, earned, nil)
	if !got[a] {
		t.Fatalf("expected lowest (a=50%%) dropped: %+v", got)
	}
	if got[b] || got[c] {
		t.Fatalf("only one drop expected: %+v", got)
	}
}

func TestItemDropsForLearner_DropHighest(t *testing.T) {
	gid := uuid.New()
	a := uuid.New()
	b := uuid.New()
	cols := []ColMeta{
		{ID: a, GroupID: &gid, Max: 100},
		{ID: b, GroupID: &gid, Max: 100},
	}
	earned := map[uuid.UUID]float64{a: 50, b: 100}
	got := ItemDropsForLearner(map[uuid.UUID]GroupDropPolicy{gid: {DropHighest: 1}}, cols, earned, nil)
	if !got[b] || got[a] {
		t.Fatalf("expected b dropped: %+v", got)
	}
}

func TestItemDropsForLearner_NeverDrop(t *testing.T) {
	gid := uuid.New()
	a := uuid.New()
	b := uuid.New()
	cols := []ColMeta{
		{ID: a, GroupID: &gid, Max: 100, NeverDrop: true},
		{ID: b, GroupID: &gid, Max: 100},
	}
	earned := map[uuid.UUID]float64{a: 10, b: 90}
	got := ItemDropsForLearner(map[uuid.UUID]GroupDropPolicy{gid: {DropLowest: 1}}, cols, earned, nil)
	if got[a] {
		t.Fatalf("never-drop should not drop a")
	}
	if !got[b] {
		t.Fatalf("expected b dropped (only droppable): %+v", got)
	}
}

func TestItemDropsForLearner_Excused(t *testing.T) {
	gid := uuid.New()
	a := uuid.New()
	b := uuid.New()
	cols := []ColMeta{
		{ID: a, GroupID: &gid, Max: 100},
		{ID: b, GroupID: &gid, Max: 100},
	}
	earned := map[uuid.UUID]float64{a: 0, b: 90}
	excused := map[uuid.UUID]bool{a: true}
	got := ItemDropsForLearner(map[uuid.UUID]GroupDropPolicy{gid: {DropLowest: 1}}, cols, earned, excused)
	if got[a] {
		t.Fatal("excused excluded from drop set")
	}
}

func TestItemDropsForLearner_NoGroup(t *testing.T) {
	a := uuid.New()
	cols := []ColMeta{{ID: a, GroupID: nil, Max: 100}}
	earned := map[uuid.UUID]float64{a: 50}
	got := ItemDropsForLearner(nil, cols, earned, nil)
	if got[a] {
		t.Fatal("no group => no drop")
	}
}

func TestItemDropsForLearner_NoMax(t *testing.T) {
	gid := uuid.New()
	a := uuid.New()
	cols := []ColMeta{{ID: a, GroupID: &gid, Max: 0}}
	got := ItemDropsForLearner(map[uuid.UUID]GroupDropPolicy{gid: {DropLowest: 1}}, cols, map[uuid.UUID]float64{a: 50}, nil)
	if got[a] {
		t.Fatal("zero max excluded")
	}
}

func TestItemDropsForLearner_NoMatchingPolicy(t *testing.T) {
	gid := uuid.New()
	a := uuid.New()
	cols := []ColMeta{{ID: a, GroupID: &gid, Max: 100}}
	got := ItemDropsForLearner(nil, cols, map[uuid.UUID]float64{a: 10}, nil)
	if got[a] {
		t.Fatal("no policy => no drop")
	}
}

func TestItemDropsForLearner_NegativeAndInfMax(t *testing.T) {
	gid := uuid.New()
	a := uuid.New()
	b := uuid.New()
	cols := []ColMeta{
		{ID: a, GroupID: &gid, Max: math.Inf(1)},
		{ID: b, GroupID: &gid, Max: 100},
	}
	earned := map[uuid.UUID]float64{a: -5, b: 50}
	got := ItemDropsForLearner(map[uuid.UUID]GroupDropPolicy{gid: {DropLowest: 1}}, cols, earned, nil)
	// inf max excluded; only b in group, dropping it
	if got[a] {
		t.Fatal("inf max excluded")
	}
	if !got[b] {
		t.Fatal("expected b dropped")
	}
}

func TestItemDropsForLearner_ReplaceWithFinalCanDrop(t *testing.T) {
	gid := uuid.New()
	a := uuid.New()
	cols := []ColMeta{{ID: a, GroupID: &gid, Max: 100, ReplaceWithFinal: true}}
	got := ItemDropsForLearner(map[uuid.UUID]GroupDropPolicy{gid: {DropLowest: 1}}, cols, map[uuid.UUID]float64{a: 10}, nil)
	if got[a] {
		t.Fatal("replace-with-final should not be droppable")
	}
}

func TestItemDropsForLearner_EmptyLines(t *testing.T) {
	got := ItemDropsForLearner(map[uuid.UUID]GroupDropPolicy{}, nil, nil, nil)
	if len(got) != 0 {
		t.Fatal("empty")
	}
}
