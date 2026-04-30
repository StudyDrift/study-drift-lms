package course

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type MarkdownThemeCustom struct {
	HeadingColor     *string `json:"headingColor"`
	BodyColor        *string `json:"bodyColor"`
	LinkColor        *string `json:"linkColor"`
	CodeBackground   *string `json:"codeBackground"`
	BlockquoteBorder *string `json:"blockquoteBorder"`
	ArticleWidth     *string `json:"articleWidth"`
	FontFamily       *string `json:"fontFamily"`
}

type CourseWithViewerResponse struct {
	Course                      CoursePublic `json:",inline"`
	ViewerEnrollmentRoles       []string     `json:"viewerEnrollmentRoles"`
	ViewerStudentEnrollmentID   *uuid.UUID   `json:"viewerStudentEnrollmentId"`
	AnnotationsEnabled          bool         `json:"annotationsEnabled"`
	FeedbackMediaEnabled        bool         `json:"feedbackMediaEnabled"`
	ResubmissionWorkflowEnabled bool         `json:"resubmissionWorkflowEnabled"`
}

type CoursePublic struct {
	ID                            uuid.UUID       `json:"id"`
	CourseCode                    string          `json:"courseCode"`
	Title                         string          `json:"title"`
	Description                   string          `json:"description"`
	HeroImageURL                  *string         `json:"heroImageUrl"`
	HeroImageObjectPosition       *string         `json:"heroImageObjectPosition"`
	StartsAt                      *time.Time      `json:"startsAt"`
	EndsAt                        *time.Time      `json:"endsAt"`
	VisibleFrom                   *time.Time      `json:"visibleFrom"`
	HiddenAt                      *time.Time      `json:"hiddenAt"`
	ScheduleMode                  string          `json:"scheduleMode"`
	RelativeEndAfter              *string         `json:"relativeEndAfter"`
	RelativeHiddenAfter           *string         `json:"relativeHiddenAfter"`
	RelativeScheduleAnchorAt      *time.Time      `json:"relativeScheduleAnchorAt"`
	Published                     bool            `json:"published"`
	MarkdownThemePreset           string          `json:"markdownThemePreset"`
	MarkdownThemeCustom           json.RawMessage `json:"markdownThemeCustom"`
	GradingScale                  string          `json:"gradingScale"`
	Archived                      bool            `json:"archived"`
	NotebookEnabled               bool            `json:"notebookEnabled"`
	FeedEnabled                   bool            `json:"feedEnabled"`
	CalendarEnabled               bool            `json:"calendarEnabled"`
	QuestionBankEnabled           bool            `json:"questionBankEnabled"`
	LockdownModeEnabled           bool            `json:"lockdownModeEnabled"`
	StandardsAlignmentEnabled     bool            `json:"standardsAlignmentEnabled"`
	AdaptivePathsEnabled          bool            `json:"adaptivePathsEnabled"`
	SrsEnabled                    bool            `json:"srsEnabled"`
	DiagnosticAssessmentsEnabled  bool            `json:"diagnosticAssessmentsEnabled"`
	HintScaffoldingEnabled        bool            `json:"hintScaffoldingEnabled"`
	MisconceptionDetectionEnabled bool            `json:"misconceptionDetectionEnabled"`
	CourseType                    string          `json:"courseType"`
	CreatedAt                     time.Time       `json:"createdAt"`
	UpdatedAt                     time.Time       `json:"updatedAt"`
	SbgEnabled                    bool            `json:"sbgEnabled"`
	SbgProficiencyScaleJSON       json.RawMessage `json:"sbgProficiencyScaleJson"`
	SbgAggregationRule            string          `json:"sbgAggregationRule"`
}

type CoursesResponse struct {
	Courses []CoursePublic `json:"courses"`
}

type UpdateCourseRequest struct {
	Title              string     `json:"title"`
	Description        string     `json:"description"`
	Published          bool       `json:"published"`
	StartsAt           *time.Time `json:"startsAt"`
	EndsAt             *time.Time `json:"endsAt"`
	VisibleFrom        *time.Time `json:"visibleFrom"`
	HiddenAt           *time.Time `json:"hiddenAt"`
	ScheduleMode       *string    `json:"scheduleMode"`
	RelativeEndAfter   *string    `json:"relativeEndAfter"`
	RelativeHiddenAfter *string   `json:"relativeHiddenAfter"`
}

type SetHeroImageRequest struct {
	ImageURL       *string `json:"imageUrl"`
	ObjectPosition *string `json:"objectPosition"`
}

type CreateCourseRequest struct {
	Title       string  `json:"title"`
	Description string  `json:"description"`
	CourseType  *string `json:"courseType"`
}

type UpdateMarkdownThemeRequest struct {
	Preset string               `json:"preset"`
	Custom *MarkdownThemeCustom `json:"custom"`
}

type PatchCourseFeaturesRequest struct {
	NotebookEnabled              bool  `json:"notebookEnabled"`
	FeedEnabled                  bool  `json:"feedEnabled"`
	CalendarEnabled              bool  `json:"calendarEnabled"`
	QuestionBankEnabled          bool  `json:"questionBankEnabled"`
	LockdownModeEnabled          bool  `json:"lockdownModeEnabled"`
	StandardsAlignmentEnabled    *bool `json:"standardsAlignmentEnabled"`
	AdaptivePathsEnabled         *bool `json:"adaptivePathsEnabled"`
	SrsEnabled                   *bool `json:"srsEnabled"`
	DiagnosticAssessmentsEnabled *bool `json:"diagnosticAssessmentsEnabled"`
	HintScaffoldingEnabled       *bool `json:"hintScaffoldingEnabled"`
	MisconceptionDetectionEnabled *bool `json:"misconceptionDetectionEnabled"`
}

type PatchCourseArchivedRequest struct {
	Archived bool `json:"archived"`
}

type PutCourseCatalogOrderRequest struct {
	CourseIDs []uuid.UUID `json:"courseIds"`
}

var MarkdownThemePresets = []string{
	"classic", "reader", "serif", "contrast", "night", "accent", "custom",
}

var GradingScales = []string{
	"letter_standard",
	"letter_plus_minus",
	"percent",
	"pass_fail",
}
