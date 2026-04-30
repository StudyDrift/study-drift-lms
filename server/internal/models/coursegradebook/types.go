package coursegradebook

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/models/assignmentrubric"
	"github.com/lextures/lextures/server/internal/models/coursegrading"
)

type CourseGradebookGridResponse struct {
	Students            []CourseGradebookGridStudent                `json:"students"`
	Columns             []CourseGradebookGridColumn                 `json:"columns"`
	Grades              map[uuid.UUID]map[uuid.UUID]string         `json:"grades"`
	DisplayGrades       map[uuid.UUID]map[uuid.UUID]string         `json:"displayGrades,omitempty"`
	RubricScores        map[uuid.UUID]map[uuid.UUID]map[uuid.UUID]string `json:"rubricScores"`
	GradeHeld           map[uuid.UUID]map[uuid.UUID]bool           `json:"gradeHeld,omitempty"`
	DroppedGrades       map[uuid.UUID]map[uuid.UUID]bool           `json:"droppedGrades,omitempty"`
	ExcusedGrades       map[uuid.UUID]map[uuid.UUID]bool           `json:"excusedGrades,omitempty"`
	GradingScheme       *GradingSchemeSummary                      `json:"gradingScheme,omitempty"`
	GradebookCSVEnabled bool                                       `json:"gradebookCsvEnabled"`
}

type GradingSchemeSummary struct {
	Type      string          `json:"type"`
	ScaleJSON json.RawMessage `json:"scaleJson"`
}

type PutCourseGradebookGradesRequest struct {
	Grades       map[uuid.UUID]map[uuid.UUID]string                `json:"grades"`
	RubricScores map[uuid.UUID]map[uuid.UUID]map[uuid.UUID]float64 `json:"rubricScores"`
	ChangeReason *string                                            `json:"changeReason"`
}

type PatchCourseGradebookExcusedRequest struct {
	StudentID uuid.UUID `json:"studentId"`
	Excused   bool      `json:"excused"`
	Reason    *string   `json:"reason"`
}

type CourseGradebookGridStudent struct {
	UserID      uuid.UUID `json:"userId"`
	DisplayName string    `json:"displayName"`
}

type CourseGradebookGridColumn struct {
	ID                   uuid.UUID                        `json:"id"`
	Kind                 string                           `json:"kind"`
	Title                string                           `json:"title"`
	MaxPoints            *int32                           `json:"maxPoints"`
	AssignmentGroupID    *uuid.UUID                       `json:"assignmentGroupId,omitempty"`
	Rubric               *assignmentrubric.RubricDefinition `json:"rubric,omitempty"`
	AssignmentGradingType *string                         `json:"assignmentGradingType,omitempty"`
	EffectiveDisplayType string                           `json:"effectiveDisplayType"`
	PostingPolicy        *string                          `json:"postingPolicy,omitempty"`
	ReleaseAt            *time.Time                       `json:"releaseAt,omitempty"`
	NeverDrop            bool                             `json:"neverDrop"`
	ReplaceWithFinal     bool                             `json:"replaceWithFinal"`
}

type CourseMyGradesResponse struct {
	Columns          []CourseGradebookGridColumn            `json:"columns"`
	Grades           map[uuid.UUID]string                   `json:"grades"`
	DisplayGrades    map[uuid.UUID]string                   `json:"displayGrades,omitempty"`
	AssignmentGroups []coursegrading.AssignmentGroupPublic  `json:"assignmentGroups"`
	GradingScheme    *GradingSchemeSummary                  `json:"gradingScheme,omitempty"`
	HeldGradeItemIDs []uuid.UUID                            `json:"heldGradeItemIds,omitempty"`
	DroppedGrades    map[uuid.UUID]bool                     `json:"droppedGrades,omitempty"`
	GradeStatuses    map[uuid.UUID]string                   `json:"gradeStatuses,omitempty"`
}

type GradeHistoryEventOut struct {
	ID             uuid.UUID  `json:"id"`
	Action         string     `json:"action"`
	PreviousScore  *float64   `json:"previousScore,omitempty"`
	NewScore       *float64   `json:"newScore,omitempty"`
	PreviousStatus *string    `json:"previousStatus,omitempty"`
	NewStatus      *string    `json:"newStatus,omitempty"`
	Reason         *string    `json:"reason,omitempty"`
	ChangedAt      time.Time  `json:"changedAt"`
	ChangedBy      *uuid.UUID `json:"changedBy,omitempty"`
}

type GradeHistoryResponse struct {
	Events []GradeHistoryEventOut `json:"events"`
}

type GradebookImportStats struct {
	Unchanged uint32 `json:"unchanged"`
	Updated   uint32 `json:"updated"`
	Added     uint32 `json:"added"`
	Errors    uint32 `json:"errors"`
	Warnings  uint32 `json:"warnings"`
}

type GradebookImportCellPreview struct {
	ItemID        uuid.UUID `json:"itemId"`
	PreviousScore *string   `json:"previousScore"`
	NewScore      string    `json:"newScore"`
	State         string    `json:"state"`
	OutOfRange    bool      `json:"outOfRange"`
}

type GradebookImportPreviewRow struct {
	RowIndex    uint                        `json:"rowIndex"`
	StudentID   *uuid.UUID                  `json:"studentId"`
	StudentName *string                     `json:"studentName"`
	Error       *string                     `json:"error"`
	Cells       []GradebookImportCellPreview `json:"cells"`
}

type GradebookImportConfirmRequest struct {
	Token                    uuid.UUID `json:"token"`
	AcknowledgeBlindManualHold *bool   `json:"acknowledgeBlindManualHold"`
}

type GradebookImportValidateResponse struct {
	Token                      *uuid.UUID                 `json:"token,omitempty"`
	Confirmable                bool                       `json:"confirmable"`
	Stats                      GradebookImportStats       `json:"stats"`
	Rows                       []GradebookImportPreviewRow `json:"rows"`
	RequireBlindManualHoldAck  bool                       `json:"requireBlindManualHoldAck"`
}
