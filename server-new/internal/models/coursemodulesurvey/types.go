package coursemodulesurvey

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

var SurveyQuestionTypes = []string{
	"likert",
	"rating",
	"single_select",
	"multi_select",
	"free_text",
	"net_promoter_score",
}

type SurveyQuestion struct {
	ID       string          `json:"id"`
	Subtype  string          `json:"subtype"`
	Stem     string          `json:"stem"`
	Required bool            `json:"required"`
	Config   json.RawMessage `json:"config"`
}

type CreateCourseSurveyRequest struct {
	ModuleID      uuid.UUID      `json:"moduleId"`
	Title         string         `json:"title"`
	Description   string         `json:"description"`
	AnonymityMode string         `json:"anonymityMode"`
	OpensAt       *time.Time     `json:"opensAt"`
	ClosesAt      *time.Time     `json:"closesAt"`
	Questions     []SurveyQuestion `json:"questions"`
}

type UpdateSurveyRequest struct {
	Title         *string          `json:"title"`
	Description   *string          `json:"description"`
	AnonymityMode *string          `json:"anonymityMode"`
	OpensAt       *time.Time       `json:"opensAt"`
	ClosesAt      *time.Time       `json:"closesAt"`
	Questions     *[]SurveyQuestion `json:"questions"`
}

type SurveyResponse struct {
	ID            uuid.UUID        `json:"id"`
	CourseID      uuid.UUID        `json:"courseId"`
	Title         string           `json:"title"`
	Description   string           `json:"description"`
	AnonymityMode string           `json:"anonymityMode"`
	OpensAt       *time.Time       `json:"opensAt"`
	ClosesAt      *time.Time       `json:"closesAt"`
	Questions     []SurveyQuestion `json:"questions"`
	UpdatedAt     time.Time        `json:"updatedAt"`
}

type SubmitSurveyResponseRequest struct {
	Answers json.RawMessage `json:"answers"`
}

type SubmitSurveyResponse struct {
	Submitted        bool  `json:"submitted"`
	AlreadySubmitted *bool `json:"alreadySubmitted,omitempty"`
}

type SurveyQuestionResult struct {
	QuestionID    string          `json:"questionId"`
	Subtype       string          `json:"subtype"`
	ResponseCount int64           `json:"responseCount"`
	Mean          *float64        `json:"mean,omitempty"`
	Distribution  json.RawMessage `json:"distribution"`
}

type SurveyResultsResponse struct {
	ResponseCount int64                 `json:"responseCount"`
	Questions     []SurveyQuestionResult `json:"questions"`
}

func ValidateAnonymityMode(mode string) bool {
	return mode == "identified" || mode == "anonymous" || mode == "pseudo_anonymous"
}

func ValidateQuestions(questions []SurveyQuestion) error {
	if len(questions) > 200 {
		return fmt.Errorf("too many survey questions (max 200)")
	}
	for _, q := range questions {
		if q.ID == "" {
			return fmt.Errorf("each survey question needs an id")
		}
		if q.Stem == "" {
			return fmt.Errorf("each survey question needs text")
		}
		ok := false
		for _, t := range SurveyQuestionTypes {
			if q.Subtype == t {
				ok = true
				break
			}
		}
		if !ok {
			return fmt.Errorf("unsupported survey question type")
		}
	}
	return nil
}
