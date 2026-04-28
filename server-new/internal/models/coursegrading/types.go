package coursegrading

import (
	"encoding/json"

	"github.com/google/uuid"
)

type AssignmentGroupPublic struct {
	ID                     uuid.UUID `json:"id"`
	SortOrder              int32     `json:"sortOrder"`
	Name                   string    `json:"name"`
	WeightPercent          float64   `json:"weightPercent"`
	DropLowest             int32     `json:"dropLowest"`
	DropHighest            int32     `json:"dropHighest"`
	ReplaceLowestWithFinal bool      `json:"replaceLowestWithFinal"`
}

type CourseGradingSettingsResponse struct {
	GradingScale             string           `json:"gradingScale"`
	AssignmentGroups         []AssignmentGroupPublic `json:"assignmentGroups"`
	SbgEnabled               bool             `json:"sbgEnabled"`
	SbgProficiencyScaleJSON  json.RawMessage  `json:"sbgProficiencyScaleJson"`
	SbgAggregationRule       string           `json:"sbgAggregationRule"`
}

type AssignmentGroupInput struct {
	ID                     *uuid.UUID `json:"id"`
	Name                   string     `json:"name"`
	SortOrder              int32      `json:"sortOrder"`
	WeightPercent          float64    `json:"weightPercent"`
	DropLowest             *int32     `json:"dropLowest"`
	DropHighest            *int32     `json:"dropHighest"`
	ReplaceLowestWithFinal *bool      `json:"replaceLowestWithFinal"`
}

type PutCourseGradingSettingsRequest struct {
	GradingScale            string               `json:"gradingScale"`
	AssignmentGroups        []AssignmentGroupInput `json:"assignmentGroups"`
	SbgEnabled              *bool                `json:"sbgEnabled"`
	SbgProficiencyScaleJSON *json.RawMessage     `json:"sbgProficiencyScaleJson"`
	SbgAggregationRule      *string              `json:"sbgAggregationRule"`
}

type PutSbgConfig struct {
	Enabled         *bool
	ScaleJSON       *json.RawMessage
	AggregationRule *string
}

type PatchItemAssignmentGroupRequest struct {
	AssignmentGroupID *uuid.UUID `json:"assignmentGroupId"`
}
