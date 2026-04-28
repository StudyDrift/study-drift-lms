package courseexport

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/models/coursegrading"
	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
	"github.com/lextures/lextures/server-new/internal/models/coursestructure"
	"github.com/lextures/lextures/server-new/internal/models/coursesyllabus"
)

type CourseImportMode string

const (
	CourseImportModeErase     CourseImportMode = "erase"
	CourseImportModeMergeAdd  CourseImportMode = "mergeAdd"
	CourseImportModeOverwrite CourseImportMode = "overwrite"
)

type CourseExportSnapshot struct {
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
}

type ExportedContentPageBody struct {
	Markdown string     `json:"markdown"`
	DueAt    *time.Time `json:"dueAt"`
}

type ExportedAssignmentBody struct {
	Markdown                     string          `json:"markdown"`
	DueAt                        *time.Time      `json:"dueAt"`
	PointsWorth                  *int32          `json:"pointsWorth"`
	AvailableFrom                *time.Time      `json:"availableFrom"`
	AvailableUntil               *time.Time      `json:"availableUntil"`
	AssignmentAccessCode         *string         `json:"assignmentAccessCode"`
	SubmissionAllowText          bool            `json:"submissionAllowText"`
	SubmissionAllowFileUpload    bool            `json:"submissionAllowFileUpload"`
	SubmissionAllowURL           bool            `json:"submissionAllowUrl"`
	LateSubmissionPolicy         string          `json:"lateSubmissionPolicy"`
	LatePenaltyPercent           *int32          `json:"latePenaltyPercent"`
	Rubric                       json.RawMessage `json:"rubric"`
	BlindGrading                 bool            `json:"blindGrading"`
	OriginalityDetection         string          `json:"originalityDetection"`
	OriginalityStudentVisibility string          `json:"originalityStudentVisibility"`
	GradingType                  *string         `json:"gradingType"`
}

type ExportedQuizBody struct {
	Markdown                    string                            `json:"markdown"`
	DueAt                       *time.Time                        `json:"dueAt"`
	AvailableFrom               *time.Time                        `json:"availableFrom"`
	AvailableUntil              *time.Time                        `json:"availableUntil"`
	UnlimitedAttempts           bool                              `json:"unlimitedAttempts"`
	MaxAttempts                 int32                             `json:"maxAttempts"`
	GradeAttemptPolicy          string                            `json:"gradeAttemptPolicy"`
	PassingScorePercent         *int32                            `json:"passingScorePercent"`
	PointsWorth                 *int32                            `json:"pointsWorth"`
	LateSubmissionPolicy        string                            `json:"lateSubmissionPolicy"`
	LatePenaltyPercent          *int32                            `json:"latePenaltyPercent"`
	TimeLimitMinutes            *int32                            `json:"timeLimitMinutes"`
	TimerPauseWhenTabHidden     bool                              `json:"timerPauseWhenTabHidden"`
	PerQuestionTimeLimitSeconds *int32                            `json:"perQuestionTimeLimitSeconds"`
	ShowScoreTiming             string                            `json:"showScoreTiming"`
	ReviewVisibility            string                            `json:"reviewVisibility"`
	ReviewWhen                  string                            `json:"reviewWhen"`
	OneQuestionAtATime          bool                              `json:"oneQuestionAtATime"`
	ShuffleQuestions            bool                              `json:"shuffleQuestions"`
	ShuffleChoices              bool                              `json:"shuffleChoices"`
	AllowBackNavigation         bool                              `json:"allowBackNavigation"`
	LockdownMode                string                            `json:"lockdownMode"`
	FocusLossThreshold          *int32                            `json:"focusLossThreshold"`
	QuizAccessCode              *string                           `json:"quizAccessCode"`
	AdaptiveDifficulty          string                            `json:"adaptiveDifficulty"`
	AdaptiveTopicBalance        bool                              `json:"adaptiveTopicBalance"`
	AdaptiveStopRule            string                            `json:"adaptiveStopRule"`
	RandomQuestionPoolCount     *int32                            `json:"randomQuestionPoolCount"`
	Questions                   []coursemodulequiz.QuizQuestion   `json:"questions"`
	IsAdaptive                  bool                              `json:"isAdaptive"`
	AdaptiveSystemPrompt        string                            `json:"adaptiveSystemPrompt"`
	AdaptiveSourceItemIDs       []uuid.UUID                       `json:"adaptiveSourceItemIds"`
	AdaptiveQuestionCount       int32                             `json:"adaptiveQuestionCount"`
	AdaptiveDeliveryMode        string                            `json:"adaptiveDeliveryMode"`
}

type ExportedCourseEnrollment struct {
	Email               string  `json:"email"`
	Role                string  `json:"role"`
	InstructorGrantRole *string `json:"instructorGrantRole"`
	DisplayName         *string `json:"displayName"`
}

type CourseExportV1 struct {
	FormatVersion             int32                                            `json:"formatVersion"`
	ExportedAt                time.Time                                        `json:"exportedAt"`
	CourseCode                string                                           `json:"courseCode"`
	Course                    CourseExportSnapshot                             `json:"course"`
	Syllabus                  []coursesyllabus.SyllabusSection                 `json:"syllabus"`
	RequireSyllabusAcceptance bool                                             `json:"requireSyllabusAcceptance"`
	Grading                   coursegrading.CourseGradingSettingsResponse      `json:"grading"`
	Structure                 []coursestructure.CourseStructureItemResponse    `json:"structure"`
	ContentPages              map[uuid.UUID]ExportedContentPageBody            `json:"contentPages"`
	Assignments               map[uuid.UUID]ExportedAssignmentBody             `json:"assignments"`
	Quizzes                   map[uuid.UUID]ExportedQuizBody                   `json:"quizzes"`
	Enrollments               []ExportedCourseEnrollment                       `json:"enrollments"`
}

type CourseImportRequest struct {
	Mode   CourseImportMode `json:"mode"`
	Export CourseExportV1   `json:"export"`
}

type CanvasImportInclude struct {
	Modules     bool `json:"modules"`
	Assignments bool `json:"assignments"`
	Quizzes     bool `json:"quizzes"`
	Enrollments bool `json:"enrollments"`
	Grades      bool `json:"grades"`
	Settings    bool `json:"settings"`
}

type CourseCanvasImportRequest struct {
	Mode          CourseImportMode   `json:"mode"`
	CanvasBaseURL string             `json:"canvasBaseUrl"`
	CanvasCourseID string            `json:"canvasCourseId"`
	AccessToken   string             `json:"accessToken"`
	Include       CanvasImportInclude `json:"include"`
}
