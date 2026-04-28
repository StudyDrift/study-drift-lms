package courseoutcomesapi

import "github.com/google/uuid"

type CourseOutcomesListResponse struct {
	EnrolledLearners int32              `json:"enrolledLearners"`
	Outcomes         []CourseOutcomeAPI `json:"outcomes"`
}

type CourseOutcomeAPI struct {
	ID                    uuid.UUID             `json:"id"`
	Title                 string                `json:"title"`
	Description           string                `json:"description"`
	SortOrder             int32                 `json:"sortOrder"`
	RollupAvgScorePercent *float32              `json:"rollupAvgScorePercent"`
	Links                 []CourseOutcomeLinkAPI `json:"links"`
}

type CourseOutcomeLinkAPI struct {
	ID              uuid.UUID  `json:"id"`
	SubOutcomeID    *uuid.UUID `json:"subOutcomeId"`
	StructureItemID uuid.UUID  `json:"structureItemId"`
	TargetKind      string     `json:"targetKind"`
	QuizQuestionID  string     `json:"quizQuestionId"`
	MeasurementLevel string    `json:"measurementLevel"`
	IntensityLevel  string     `json:"intensityLevel"`
	ItemTitle       string     `json:"itemTitle"`
	ItemKind        string     `json:"itemKind"`
	Progress        any        `json:"progress"`
}

type PostCourseOutcomeRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type PatchCourseOutcomeRequest struct {
	Title                 *string     `json:"title"`
	Description           *string     `json:"description"`
	ModuleStructureItemID **uuid.UUID `json:"moduleStructureItemId"`
}

type PostCourseOutcomeLinkRequest struct {
	StructureItemID  uuid.UUID `json:"structureItemId"`
	TargetKind       string    `json:"targetKind"`
	QuizQuestionID   *string   `json:"quizQuestionId"`
	MeasurementLevel *string   `json:"measurementLevel"`
	IntensityLevel   *string   `json:"intensityLevel"`
	SubOutcomeID     *uuid.UUID `json:"subOutcomeId"`
}

type PostCourseOutcomeSubOutcomeRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type CourseOutcomeSubOutcomeAPI struct {
	ID          uuid.UUID `json:"id"`
	OutcomeID   uuid.UUID `json:"outcomeId"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	SortOrder   int32     `json:"sortOrder"`
}
