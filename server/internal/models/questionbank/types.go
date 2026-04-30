package questionbank

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type QuestionOptionMisconceptionTagAPI struct {
	OptionID        uuid.UUID `json:"optionId"`
	MisconceptionID uuid.UUID `json:"misconceptionId"`
}

type QuestionBankRowResponse struct {
	ID                        uuid.UUID                            `json:"id"`
	CourseID                  uuid.UUID                            `json:"courseId"`
	QuestionType              string                               `json:"questionType"`
	Stem                      string                               `json:"stem"`
	Options                   json.RawMessage                      `json:"options,omitempty"`
	CorrectAnswer             json.RawMessage                      `json:"correctAnswer,omitempty"`
	Explanation               *string                              `json:"explanation,omitempty"`
	Points                    float64                              `json:"points"`
	Status                    string                               `json:"status"`
	Shared                    bool                                 `json:"shared"`
	Source                    string                               `json:"source"`
	Metadata                  json.RawMessage                      `json:"metadata"`
	IrtA                      *float64                             `json:"irtA,omitempty"`
	IrtB                      *float64                             `json:"irtB,omitempty"`
	IrtC                      *float64                             `json:"irtC,omitempty"`
	IrtStatus                 string                               `json:"irtStatus"`
	IrtSampleN                *int32                               `json:"irtSampleN,omitempty"`
	IrtCalibratedAt           *time.Time                           `json:"irtCalibratedAt,omitempty"`
	CreatedBy                 *uuid.UUID                           `json:"createdBy,omitempty"`
	CreatedAt                 time.Time                            `json:"createdAt"`
	UpdatedAt                 time.Time                            `json:"updatedAt"`
	VersionNumber             int32                                `json:"versionNumber"`
	IsPublished               bool                                 `json:"isPublished"`
	ShuffleChoicesOverride    *bool                                `json:"shuffleChoicesOverride,omitempty"`
	SrsEligible               bool                                 `json:"srsEligible"`
	OptionMisconceptionTags   []QuestionOptionMisconceptionTagAPI `json:"optionMisconceptionTags,omitempty"`
}

type CreateQuestionRequest struct {
	QuestionType           string          `json:"questionType"`
	Stem                   string          `json:"stem"`
	Options                json.RawMessage `json:"options"`
	CorrectAnswer          json.RawMessage `json:"correctAnswer"`
	Explanation            *string         `json:"explanation"`
	Points                 *float64        `json:"points"`
	Status                 *string         `json:"status"`
	Shared                 *bool           `json:"shared"`
	Metadata               json.RawMessage `json:"metadata"`
	ShuffleChoicesOverride *bool           `json:"shuffleChoicesOverride"`
	SrsEligible            *bool           `json:"srsEligible"`
}

type UpdateQuestionRequest struct {
	QuestionType           *string          `json:"questionType"`
	Stem                   *string          `json:"stem"`
	Options                *json.RawMessage `json:"options"`
	CorrectAnswer          *json.RawMessage `json:"correctAnswer"`
	Explanation            **string         `json:"explanation"`
	Points                 *float64         `json:"points"`
	Status                 *string          `json:"status"`
	Shared                 *bool            `json:"shared"`
	Metadata               json.RawMessage  `json:"metadata"`
	ChangeNote             *string          `json:"changeNote"`
	ShuffleChoicesOverride **bool           `json:"shuffleChoicesOverride"`
	SrsEligible            *bool            `json:"srsEligible"`
}

type QuestionVersionSummaryResponse struct {
	VersionNumber int32           `json:"versionNumber"`
	ChangeNote    *string         `json:"changeNote,omitempty"`
	ChangeSummary json.RawMessage `json:"changeSummary,omitempty"`
	CreatedBy     *uuid.UUID      `json:"createdBy,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type RestoreQuestionVersionRequest struct {
	ChangeNote *string `json:"changeNote"`
}

type QuestionPoolResponse struct {
	ID          uuid.UUID  `json:"id"`
	CourseID    uuid.UUID  `json:"courseId"`
	Name        string     `json:"name"`
	Description *string    `json:"description,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type CreateQuestionPoolRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
}

type AddPoolMembersRequest struct {
	QuestionIDs []uuid.UUID `json:"questionIds"`
}

type BulkImportQuestionsResponse struct {
	ImportedCount uint `json:"importedCount"`
}

type IccPoint struct {
	Theta    float64 `json:"theta"`
	PCorrect float64 `json:"pCorrect"`
}

type QuestionIrtStatsResponse struct {
	A            *float64   `json:"a"`
	B            *float64   `json:"b"`
	C            *float64   `json:"c"`
	Status       string     `json:"status"`
	SampleN      int32      `json:"sampleN"`
	CalibratedAt *time.Time `json:"calibratedAt,omitempty"`
	Icc          []IccPoint `json:"icc"`
}

type SetQuizDeliveryRefsRequest struct {
	Mode    string     `json:"mode"`
	PoolID  *uuid.UUID `json:"poolId"`
	SampleN *int32     `json:"sampleN"`
}

type QuestionHintAuthorResponse struct {
	ID         uuid.UUID  `json:"id"`
	QuestionID uuid.UUID  `json:"questionId"`
	Level      int32      `json:"level"`
	Body       string     `json:"body"`
	MediaURL   *string    `json:"mediaUrl,omitempty"`
	Locale     string     `json:"locale"`
	PenaltyPct float64    `json:"penaltyPct"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type CreateQuestionHintRequest struct {
	Level      int32    `json:"level"`
	Body       string   `json:"body"`
	MediaURL   *string  `json:"mediaUrl"`
	Locale     *string  `json:"locale"`
	PenaltyPct *float64 `json:"penaltyPct"`
}

type UpdateQuestionHintRequest struct {
	Level      int32    `json:"level"`
	Body       string   `json:"body"`
	MediaURL   *string  `json:"mediaUrl"`
	Locale     *string  `json:"locale"`
	PenaltyPct *float64 `json:"penaltyPct"`
}

type UpsertWorkedExampleRequest struct {
	Title *string           `json:"title"`
	Body  *string           `json:"body"`
	Steps []json.RawMessage `json:"steps"`
}

type HintAnalyticsLevel struct {
	Level        int32   `json:"level"`
	RequestCount int64   `json:"requestCount"`
	PctUsers     float64 `json:"pctUsers"`
}

type HintAnalyticsResponse struct {
	Levels []HintAnalyticsLevel `json:"levels"`
}
