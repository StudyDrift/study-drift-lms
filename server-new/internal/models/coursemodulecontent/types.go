package coursemodulecontent

import (
	"time"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/models/assignmentrubric"
)

type ModuleContentPageResponse struct {
	ItemID                      uuid.UUID                        `json:"itemId"`
	Title                       string                           `json:"title"`
	Markdown                    string                           `json:"markdown"`
	DueAt                       *time.Time                       `json:"dueAt"`
	PointsWorth                 *int32                           `json:"pointsWorth"`
	AssignmentGroupID           *uuid.UUID                       `json:"assignmentGroupId,omitempty"`
	UpdatedAt                   time.Time                        `json:"updatedAt"`
	AvailableFrom               *time.Time                       `json:"availableFrom,omitempty"`
	AvailableUntil              *time.Time                       `json:"availableUntil,omitempty"`
	RequiresAssignmentAccessCode *bool                           `json:"requiresAssignmentAccessCode,omitempty"`
	AssignmentAccessCode        *string                          `json:"assignmentAccessCode,omitempty"`
	SubmissionAllowText         *bool                            `json:"submissionAllowText,omitempty"`
	SubmissionAllowFileUpload   *bool                            `json:"submissionAllowFileUpload,omitempty"`
	SubmissionAllowURL          *bool                            `json:"submissionAllowUrl,omitempty"`
	LateSubmissionPolicy        *string                          `json:"lateSubmissionPolicy,omitempty"`
	LatePenaltyPercent          *int32                           `json:"latePenaltyPercent,omitempty"`
	Rubric                      *assignmentrubric.RubricDefinition `json:"rubric,omitempty"`
	BlindGrading                bool                             `json:"blindGrading"`
	IdentitiesRevealedAt        *time.Time                       `json:"identitiesRevealedAt,omitempty"`
	ViewerCanRevealIdentities   bool                             `json:"viewerCanRevealIdentities"`
	ModeratedGrading            bool                             `json:"moderatedGrading"`
	ModerationThresholdPct      *int32                           `json:"moderationThresholdPct,omitempty"`
	ModeratorUserID             *uuid.UUID                       `json:"moderatorUserId,omitempty"`
	ProvisionalGraderUserIDs    []uuid.UUID                      `json:"provisionalGraderUserIds,omitempty"`
	OriginalityDetection        *string                          `json:"originalityDetection,omitempty"`
	OriginalityStudentVisibility *string                         `json:"originalityStudentVisibility,omitempty"`
	GradingType                 *string                          `json:"gradingType,omitempty"`
	PostingPolicy               *string                          `json:"postingPolicy,omitempty"`
	ReleaseAt                   *time.Time                       `json:"releaseAt,omitempty"`
	NeverDrop                   bool                             `json:"neverDrop"`
	ReplaceWithFinal            bool                             `json:"replaceWithFinal"`
}

type GenerateAssignmentRubricRequest struct {
	Prompt             string  `json:"prompt"`
	AssignmentMarkdown *string `json:"assignmentMarkdown"`
}

type GenerateAssignmentRubricResponse struct {
	Rubric assignmentrubric.RubricDefinition `json:"rubric"`
}

type CreateCourseContentPageRequest struct {
	Title string `json:"title"`
}

type UpdateModuleContentPageRequest struct {
	Markdown                    string                            `json:"markdown"`
	DueAt                       **time.Time                       `json:"dueAt"`
	PointsWorth                 **int32                           `json:"pointsWorth"`
	AvailableFrom               **time.Time                       `json:"availableFrom"`
	AvailableUntil              **time.Time                       `json:"availableUntil"`
	AssignmentAccessCode        **string                          `json:"assignmentAccessCode"`
	SubmissionAllowText         *bool                             `json:"submissionAllowText"`
	SubmissionAllowFileUpload   *bool                             `json:"submissionAllowFileUpload"`
	SubmissionAllowURL          *bool                             `json:"submissionAllowUrl"`
	LateSubmissionPolicy        *string                           `json:"lateSubmissionPolicy"`
	LatePenaltyPercent          **int32                           `json:"latePenaltyPercent"`
	Rubric                      **assignmentrubric.RubricDefinition `json:"rubric"`
	BlindGrading                *bool                             `json:"blindGrading"`
	ModeratedGrading            *bool                             `json:"moderatedGrading"`
	ModerationThresholdPct      *int32                            `json:"moderationThresholdPct"`
	ModeratorUserID             **uuid.UUID                       `json:"moderatorUserId"`
	ProvisionalGraderUserIDs    *[]uuid.UUID                      `json:"provisionalGraderUserIds"`
	OriginalityDetection        *string                           `json:"originalityDetection"`
	OriginalityStudentVisibility *string                          `json:"originalityStudentVisibility"`
	GradingType                 **string                          `json:"gradingType"`
	PostingPolicy               *string                           `json:"postingPolicy"`
	ReleaseAt                   **time.Time                       `json:"releaseAt"`
	NeverDrop                   *bool                             `json:"neverDrop"`
	ReplaceWithFinal            *bool                             `json:"replaceWithFinal"`
}
