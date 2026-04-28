package assignmentrubric

import (
	"fmt"
	"math"

	"github.com/google/uuid"
)

const (
	MaxCriteria           = 40
	MaxLevelsPerCriterion = 12
	MaxTitleLen           = 512
	MaxDescLen            = 2000
	MaxLevelLabelLen      = 256
	MaxLevelDescLen       = 2000
)

type RubricDefinition struct {
	Title    *string           `json:"title,omitempty"`
	Criteria []RubricCriterion `json:"criteria"`
}

type RubricCriterion struct {
	ID          uuid.UUID     `json:"id"`
	Title       string        `json:"title"`
	Description *string       `json:"description,omitempty"`
	Levels      []RubricLevel `json:"levels"`
}

type RubricLevel struct {
	Label       string  `json:"label"`
	Points      float64 `json:"points"`
	Description *string `json:"description,omitempty"`
}

func ValidateRubricDefinition(r *RubricDefinition) error {
	if r == nil {
		return fmt.Errorf("rubric is required")
	}
	if r.Title != nil {
		if len(*r.Title) == 0 || len(*r.Title) > MaxTitleLen {
			return fmt.Errorf("invalid rubric title")
		}
	}
	if len(r.Criteria) == 0 {
		return fmt.Errorf("rubric must include at least one criterion")
	}
	if len(r.Criteria) > MaxCriteria {
		return fmt.Errorf("rubric cannot have more than %d criteria", MaxCriteria)
	}
	seen := map[uuid.UUID]bool{}
	for _, c := range r.Criteria {
		if seen[c.ID] {
			return fmt.Errorf("rubric criterion ids must be unique")
		}
		seen[c.ID] = true
		if len(c.Title) == 0 || len(c.Title) > MaxTitleLen {
			return fmt.Errorf("invalid rubric criterion title")
		}
		if c.Description != nil && len(*c.Description) > MaxDescLen {
			return fmt.Errorf("rubric criterion description is too long")
		}
		if len(c.Levels) == 0 || len(c.Levels) > MaxLevelsPerCriterion {
			return fmt.Errorf("invalid rubric levels")
		}
		for _, lvl := range c.Levels {
			if len(lvl.Label) == 0 || len(lvl.Label) > MaxLevelLabelLen {
				return fmt.Errorf("invalid rubric level label")
			}
			if lvl.Description != nil && len(*lvl.Description) > MaxLevelDescLen {
				return fmt.Errorf("rubric level description is too long")
			}
			if math.IsNaN(lvl.Points) || math.IsInf(lvl.Points, 0) || lvl.Points < 0 {
				return fmt.Errorf("rubric level points must be non-negative finite")
			}
		}
	}
	return nil
}

func ValidateRubricAgainstPointsWorth(r *RubricDefinition, pointsWorth *int32) error {
	if pointsWorth == nil || *pointsWorth <= 0 {
		return nil
	}
	var sumMax float64
	for _, c := range r.Criteria {
		maxPts := 0.0
		for _, lvl := range c.Levels {
			if lvl.Points > maxPts {
				maxPts = lvl.Points
			}
		}
		sumMax += maxPts
	}
	if math.Abs(sumMax-float64(*pointsWorth)) > 1e-3 {
		return fmt.Errorf("rubric total must equal assignment points")
	}
	return nil
}

func ValidateRubricScoresForGrade(r *RubricDefinition, scores map[uuid.UUID]float64) (float64, error) {
	total := 0.0
	for _, c := range r.Criteria {
		p, ok := scores[c.ID]
		if !ok {
			return 0, fmt.Errorf("missing rubric score for criterion")
		}
		match := false
		for _, lvl := range c.Levels {
			if math.Abs(lvl.Points-p) < 1e-6 {
				match = true
				break
			}
		}
		if !match {
			return 0, fmt.Errorf("rubric score must match criterion level points")
		}
		total += p
	}
	if len(scores) != len(r.Criteria) {
		return 0, fmt.Errorf("rubric grading includes unknown criteria")
	}
	return total, nil
}
