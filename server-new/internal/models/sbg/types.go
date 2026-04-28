package sbg

import (
	"time"

	"github.com/google/uuid"
)

type SbgStandardPublic struct {
	ID          uuid.UUID `json:"id"`
	ExternalID  *string   `json:"externalId"`
	Description string    `json:"description"`
	Subject     *string   `json:"subject"`
	GradeLevel  *string   `json:"gradeLevel"`
	Position    int32     `json:"position"`
}

type SbgStandardsListResponse struct {
	Standards []SbgStandardPublic `json:"standards"`
}

type SbgGradebookCell struct {
	StudentUserID uuid.UUID `json:"studentUserId"`
	StandardID    uuid.UUID `json:"standardId"`
	LevelLabel    string    `json:"levelLabel"`
}

type SbgStandardsGradebookResponse struct {
	Standards     []SbgStandardPublic  `json:"standards"`
	Students      []SbgGradebookStudent `json:"students"`
	Proficiencies []SbgGradebookCell   `json:"proficiencies"`
}

type SbgGradebookStudent struct {
	UserID       uuid.UUID `json:"userId"`
	DisplayLabel string    `json:"displayLabel"`
}

type SbgMasteryTranscriptRow struct {
	StandardID   uuid.UUID  `json:"standardId"`
	ExternalID   *string    `json:"externalId"`
	Description  string     `json:"description"`
	Proficiency  *float64   `json:"proficiency"`
	LevelLabel   string     `json:"levelLabel"`
	LastAssessed *time.Time `json:"lastAssessed"`
}

type SbgMasteryTranscriptResponse struct {
	CourseTitle   string                   `json:"courseTitle"`
	CourseCode    string                   `json:"courseCode"`
	StudentUserID uuid.UUID                `json:"studentUserId"`
	Rows          []SbgMasteryTranscriptRow `json:"rows"`
}

type SbgItemAlignmentsPut struct {
	Alignments []SbgItemAlignmentItem `json:"alignments"`
}

type SbgItemAlignmentItem struct {
	StandardID    uuid.UUID `json:"standardId"`
	AlignableType string    `json:"alignableType"`
	AlignableID   uuid.UUID `json:"alignableId"`
	Weight        float64   `json:"weight"`
}
