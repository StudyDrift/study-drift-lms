// Package gradingdrops implements assignment-group drop rules (Rust `services/grading/assignment_groups` subset).
package gradingdrops

import (
	"math"
	"sort"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/repos/coursegrading"
)

// GroupDropPolicy is drop settings from an assignment group row.
type GroupDropPolicy struct {
	DropLowest             int
	DropHighest            int
	ReplaceLowestWithFinal bool
}

// ColMeta is one gradable column for drop math.
type ColMeta struct {
	ID               uuid.UUID
	GroupID          *uuid.UUID
	Max              float64
	NeverDrop        bool
	ReplaceWithFinal bool
}

// GroupScoreLine is one gradable line for drop math.
type groupScoreLine struct {
	itemID            uuid.UUID
	maxPoints         float64
	earnedPoints      float64
	neverDrop         bool
	replaceWithFinal  bool
}

// scored is a row after pct computation.
type scored struct {
	id       uuid.UUID
	max      float64
	earned   float64
	pct      float64
	canDrop  bool
	isFinal  bool
}

// computeGroupAverageWithDrops matches Rust `compute_group_average_with_drops` (dropped set only).
func computeGroupAverageWithDrops(policy *GroupDropPolicy, lines []groupScoreLine) map[uuid.UUID]struct{} {
	if len(lines) == 0 {
		return nil
	}
	var rows []scored
	for _, l := range lines {
		max := 0.0
		if l.maxPoints > 0 && !math.IsInf(l.maxPoints, 0) {
			max = l.maxPoints
		}
		earned := l.earnedPoints
		if earned < 0 {
			earned = 0
		}
		pct := 0.0
		if max > 0 {
			pct = earned / max
		}
		if !math.IsInf(pct, 0) {
			// keep finite
		} else {
			pct = 0
		}
		if math.IsNaN(pct) {
			pct = 0
		}
		isFinal := l.replaceWithFinal
		canDrop := !l.neverDrop && !isFinal
		if max > 0 {
			rows = append(rows, scored{
				id: l.itemID, max: max, earned: earned, pct: pct, canDrop: canDrop, isFinal: isFinal,
			})
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].pct != rows[j].pct {
			return rows[i].pct < rows[j].pct
		}
		return rows[i].id.String() < rows[j].id.String()
	})
	var work []scored
	for i := range rows {
		if rows[i].canDrop {
			work = append(work, rows[i])
		}
	} // work keeps ascending pct order among droppable rows
	dropped := make(map[uuid.UUID]struct{})
	nLow := policy.DropLowest
	if nLow < 0 {
		nLow = 0
	}
	nHigh := policy.DropHighest
	if nHigh < 0 {
		nHigh = 0
	}
	for k := 0; k < nLow && len(work) > 0; k++ {
		dropped[work[0].id] = struct{}{}
		work = work[1:]
	}
	for k := 0; k < nHigh && len(work) > 0; k++ {
		dropped[work[len(work)-1].id] = struct{}{}
		work = work[:len(work)-1]
	}
	return dropped
}

// ItemDropsForLearner returns per-item `dropped` for one student (Rust `item_drops_for_learner`).
func ItemDropsForLearner(
	groupPolicies map[uuid.UUID]GroupDropPolicy,
	colMeta []ColMeta,
	earnedByItem map[uuid.UUID]float64,
	excusedByItem map[uuid.UUID]bool,
) map[uuid.UUID]bool {
	out := make(map[uuid.UUID]bool)
	for _, c := range colMeta {
		out[c.ID] = false
	}
	byGroup := make(map[uuid.UUID][]groupScoreLine)
	for i := range colMeta {
		c := &colMeta[i]
		if c.Max <= 0 {
			continue
		}
		if c.GroupID == nil {
			continue
		}
		if excusedByItem[c.ID] {
			continue
		}
		e := earnedByItem[c.ID]
		byGroup[*c.GroupID] = append(byGroup[*c.GroupID], groupScoreLine{
			itemID:           c.ID,
			maxPoints:        c.Max,
			earnedPoints:     e,
			neverDrop:        c.NeverDrop,
			replaceWithFinal: c.ReplaceWithFinal,
		})
	}
	for gid, lines := range byGroup {
		pol, ok := groupPolicies[gid]
		if !ok {
			continue
		}
		dset := computeGroupAverageWithDrops(&pol, lines)
		for d := range dset {
			out[d] = true
		}
	}
	return out
}

// GroupPoliciesFromSettings builds a map from assignment group list.
func GroupPoliciesFromSettings(groups []coursegrading.AssignmentGroupPublic) map[uuid.UUID]GroupDropPolicy {
	out := make(map[uuid.UUID]GroupDropPolicy)
	for _, g := range groups {
		dl := g.DropLowest
		if dl < 0 {
			dl = 0
		}
		dh := g.DropHighest
		if dh < 0 {
			dh = 0
		}
		out[g.ID] = GroupDropPolicy{
			DropLowest:             dl,
			DropHighest:            dh,
			ReplaceLowestWithFinal: g.ReplaceLowestWithFinal,
		}
	}
	return out
}
