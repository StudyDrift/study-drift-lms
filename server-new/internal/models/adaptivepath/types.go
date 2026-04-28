package adaptivepath

import (
	"time"

	"github.com/google/uuid"
)

type StructurePathRuleResponse struct {
	ID              uuid.UUID  `json:"id"`
	StructureItemID uuid.UUID  `json:"structureItemId"`
	RuleType        string     `json:"ruleType"`
	ConceptIDs      []uuid.UUID `json:"conceptIds"`
	Threshold       float64    `json:"threshold"`
	TargetItemID    *uuid.UUID `json:"targetItemId"`
	Priority        int16      `json:"priority"`
	CreatedAt       time.Time  `json:"createdAt"`
}

type CreateStructurePathRuleRequest struct {
	RuleType     string      `json:"ruleType"`
	ConceptIDs   []uuid.UUID `json:"conceptIds"`
	Threshold    float64     `json:"threshold"`
	TargetItemID *uuid.UUID  `json:"targetItemId"`
	Priority     *int16      `json:"priority"`
}

type EnrollmentNextResponse struct {
	Item          any     `json:"item"`
	SkipReason    *string `json:"skipReason"`
	SkipReasonKey *string `json:"skipReasonKey"`
	Fallback      bool    `json:"fallback"`
}

type PutEnrollmentPathOverrideRequest struct {
	ItemSequence []uuid.UUID `json:"itemSequence"`
}

type AdaptivePathPreviewResponse struct {
	Path     []uuid.UUID `json:"path"`
	Fallback bool        `json:"fallback"`
}

type AdaptivePathPreviewQuery struct {
	Mastery string `json:"mastery"`
}
