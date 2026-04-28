package coursemodulequiz

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/models/latesubmissionpolicy"
)

var QuizQuestionTypes = []string{"multiple_choice", "fill_in_blank", "essay", "true_false", "short_answer", "matching", "ordering", "hotspot", "numeric", "formula", "code", "file_upload", "audio_response", "video_response"}
var GradeAttemptPolicies = []string{"highest", "latest", "first", "average"}
var ShowScoreTimings = []string{"immediate", "after_due", "manual"}
var ReviewVisibilities = []string{"none", "score_only", "responses", "correct_answers", "full"}
var ReviewWhens = []string{"after_submit", "after_due", "always", "never"}
var AdaptiveDifficulties = []string{"introductory", "standard", "challenging"}
var AdaptiveStopRules = []string{"fixed_count", "mastery_estimate"}

const (
	MaxQuizQuestions            = 300
	MaxAdaptiveQuestionCount    = 30
	MinAdaptiveQuestionCount    = 1
	MaxQuizAccessCodeLen        = 128
	MaxItemPointsWorth          = 1_000_000
)

func ValidateItemPointsWorth(pointsWorth *int32) error {
	if pointsWorth == nil {
		return nil
	}
	if *pointsWorth < 0 || *pointsWorth > MaxItemPointsWorth {
		return fmt.Errorf("pointsWorth must be between 0 and %d", MaxItemPointsWorth)
	}
	return nil
}

func ValidateQuizComprehensiveSettings(lateSubmissionPolicy string, latePenaltyPercent *int32, quizAccessCode *string) error {
	if err := latesubmissionpolicy.ValidateLateSubmissionPolicyPair(lateSubmissionPolicy, latePenaltyPercent); err != nil {
		return err
	}
	if quizAccessCode != nil && len(*quizAccessCode) > MaxQuizAccessCodeLen {
		return fmt.Errorf("quizAccessCode too long")
	}
	return nil
}

type QuizQuestion struct {
	ID                 string          `json:"id"`
	Prompt             string          `json:"prompt"`
	QuestionType       string          `json:"questionType"`
	Choices            []string        `json:"choices"`
	ChoiceIDs          []string        `json:"choiceIds"`
	TypeConfig         json.RawMessage `json:"typeConfig"`
	CorrectChoiceIndex *uint           `json:"correctChoiceIndex"`
	MultipleAnswer     bool            `json:"multipleAnswer"`
	AnswerWithImage    bool            `json:"answerWithImage"`
	Required           bool            `json:"required"`
	Points             int32           `json:"points"`
	EstimatedMinutes   int32           `json:"estimatedMinutes"`
	ConceptIDs         []string        `json:"conceptIds"`
	SrsEligible        bool            `json:"srsEligible"`
}

type ModuleQuizResponse struct {
	ItemID                        uuid.UUID      `json:"itemId"`
	Title                         string         `json:"title"`
	Markdown                      string         `json:"markdown"`
	DueAt                         *time.Time     `json:"dueAt"`
	AvailableFrom                 *time.Time     `json:"availableFrom"`
	AvailableUntil                *time.Time     `json:"availableUntil"`
	UnlimitedAttempts             bool           `json:"unlimitedAttempts"`
	MaxAttempts                   int32          `json:"maxAttempts"`
	GradeAttemptPolicy            string         `json:"gradeAttemptPolicy"`
	PassingScorePercent           *int32         `json:"passingScorePercent"`
	PointsWorth                   *int32         `json:"pointsWorth"`
	LateSubmissionPolicy          string         `json:"lateSubmissionPolicy"`
	LatePenaltyPercent            *int32         `json:"latePenaltyPercent"`
	TimeLimitMinutes              *int32         `json:"timeLimitMinutes"`
	TimerPauseWhenTabHidden       bool           `json:"timerPauseWhenTabHidden"`
	PerQuestionTimeLimitSeconds   *int32         `json:"perQuestionTimeLimitSeconds"`
	ShowScoreTiming               string         `json:"showScoreTiming"`
	ReviewVisibility              string         `json:"reviewVisibility"`
	ReviewWhen                    string         `json:"reviewWhen"`
	OneQuestionAtATime            bool           `json:"oneQuestionAtATime"`
	ShuffleQuestions              bool           `json:"shuffleQuestions"`
	ShuffleChoices                bool           `json:"shuffleChoices"`
	AllowBackNavigation           bool           `json:"allowBackNavigation"`
	LockdownMode                  string         `json:"lockdownMode"`
	FocusLossThreshold            *int32         `json:"focusLossThreshold,omitempty"`
	RequiresQuizAccessCode        bool           `json:"requiresQuizAccessCode"`
	QuizAccessCode                *string        `json:"quizAccessCode,omitempty"`
	AdaptiveDifficulty            string         `json:"adaptiveDifficulty"`
	AdaptiveTopicBalance          bool           `json:"adaptiveTopicBalance"`
	AdaptiveStopRule              string         `json:"adaptiveStopRule"`
	RandomQuestionPoolCount       *int32         `json:"randomQuestionPoolCount"`
	Questions                     []QuizQuestion `json:"questions"`
	UsesServerQuestionSampling    bool           `json:"usesServerQuestionSampling"`
	UpdatedAt                     time.Time      `json:"updatedAt"`
	IsAdaptive                    bool           `json:"isAdaptive"`
	AdaptiveSystemPrompt          *string        `json:"adaptiveSystemPrompt,omitempty"`
	AdaptiveSourceItemIDs         []uuid.UUID    `json:"adaptiveSourceItemIds,omitempty"`
	AdaptiveQuestionCount         int32          `json:"adaptiveQuestionCount"`
	AdaptiveDeliveryMode          string         `json:"adaptiveDeliveryMode"`
	AssignmentGroupID             *uuid.UUID     `json:"assignmentGroupId,omitempty"`
	HintScaffoldingEnabled        bool           `json:"hintScaffoldingEnabled"`
	MisconceptionDetectionEnabled bool           `json:"misconceptionDetectionEnabled"`
	NeverDrop                     bool           `json:"neverDrop"`
	ReplaceWithFinal              bool           `json:"replaceWithFinal"`
}

type ModuleQuizGetQuery struct{ AttemptID *uuid.UUID `json:"attemptId"` }
type CreateCourseQuizRequest struct{ Title string `json:"title"` }
type UpdateModuleQuizRequest struct {
	Title                   *string       `json:"title"`
	Markdown                *string       `json:"markdown"`
	Questions               *[]QuizQuestion `json:"questions"`
	DueAt                   **time.Time   `json:"dueAt"`
	AvailableFrom           **time.Time   `json:"availableFrom"`
	AvailableUntil          **time.Time   `json:"availableUntil"`
	UnlimitedAttempts       *bool         `json:"unlimitedAttempts"`
	OneQuestionAtATime      *bool         `json:"oneQuestionAtATime"`
	MaxAttempts             *int32        `json:"maxAttempts"`
	GradeAttemptPolicy      *string       `json:"gradeAttemptPolicy"`
	PassingScorePercent     **int32       `json:"passingScorePercent"`
	PointsWorth             **int32       `json:"pointsWorth"`
	LateSubmissionPolicy    *string       `json:"lateSubmissionPolicy"`
	LatePenaltyPercent      **int32       `json:"latePenaltyPercent"`
	TimeLimitMinutes        **int32       `json:"timeLimitMinutes"`
	TimerPauseWhenTabHidden *bool         `json:"timerPauseWhenTabHidden"`
	PerQuestionTimeLimitSeconds **int32   `json:"perQuestionTimeLimitSeconds"`
	ShowScoreTiming         *string       `json:"showScoreTiming"`
	ReviewVisibility        *string       `json:"reviewVisibility"`
	ReviewWhen              *string       `json:"reviewWhen"`
	ShuffleQuestions        *bool         `json:"shuffleQuestions"`
	ShuffleChoices          *bool         `json:"shuffleChoices"`
	AllowBackNavigation     *bool         `json:"allowBackNavigation"`
	QuizAccessCode          **string      `json:"quizAccessCode"`
	AdaptiveDifficulty      *string       `json:"adaptiveDifficulty"`
	AdaptiveTopicBalance    *bool         `json:"adaptiveTopicBalance"`
	AdaptiveStopRule        *string       `json:"adaptiveStopRule"`
	RandomQuestionPoolCount **int32       `json:"randomQuestionPoolCount"`
	LockdownMode            *string       `json:"lockdownMode"`
	FocusLossThreshold      **int32       `json:"focusLossThreshold"`
	IsAdaptive              *bool         `json:"isAdaptive"`
	AdaptiveSystemPrompt    *string       `json:"adaptiveSystemPrompt"`
	AdaptiveSourceItemIDs   *[]uuid.UUID  `json:"adaptiveSourceItemIds"`
	AdaptiveQuestionCount   *int32        `json:"adaptiveQuestionCount"`
	AdaptiveDeliveryMode    *string       `json:"adaptiveDeliveryMode"`
	NeverDrop               *bool         `json:"neverDrop"`
	ReplaceWithFinal        *bool         `json:"replaceWithFinal"`
}

type GenerateModuleQuizQuestionsRequest struct {
	Prompt string `json:"prompt"`
	QuestionCount int32 `json:"questionCount"`
}
type GenerateModuleQuizQuestionsResponse struct{ Questions []QuizQuestion `json:"questions"` }
type AdaptiveQuizNextRequest struct{ AttemptID *uuid.UUID `json:"attemptId"`; History []AdaptiveQuizHistoryTurn `json:"history"` }
type AdaptiveQuizHistoryTurn struct {
	QuestionID *string `json:"questionId,omitempty"`
	Prompt string `json:"prompt"`
	QuestionType string `json:"questionType"`
	Choices []string `json:"choices"`
	ChoiceWeights []float64 `json:"choiceWeights"`
	SelectedChoiceIndex *uint `json:"selectedChoiceIndex"`
	Points *int32 `json:"points"`
}
type AdaptiveQuizGeneratedQuestion struct {
	QuestionID *uuid.UUID `json:"questionId,omitempty"`
	Prompt string `json:"prompt"`
	QuestionType string `json:"questionType"`
	Choices []string `json:"choices"`
	ChoiceWeights []float64 `json:"choiceWeights"`
	MultipleAnswer bool `json:"multipleAnswer"`
	AnswerWithImage bool `json:"answerWithImage"`
	Required bool `json:"required"`
	Points int32 `json:"points"`
	EstimatedMinutes int32 `json:"estimatedMinutes"`
}
type AdaptiveQuizNextResponse struct{ Finished bool `json:"finished"`; Questions []AdaptiveQuizGeneratedQuestion `json:"questions,omitempty"`; Message *string `json:"message,omitempty"` }
type QuizStartRequest struct{ QuizAccessCode *string `json:"quizAccessCode"` }
type QuizStartResponse struct {
	AttemptID uuid.UUID `json:"attemptId"`; AttemptNumber int32 `json:"attemptNumber"`; StartedAt time.Time `json:"startedAt"`; LockdownMode string `json:"lockdownMode"`; HintsDisabled bool `json:"hintsDisabled"`; BackNavigationAllowed bool `json:"backNavigationAllowed"`; CurrentQuestionIndex int32 `json:"currentQuestionIndex"`; DeadlineAt *time.Time `json:"deadlineAt,omitempty"`; ReducedDistractionMode bool `json:"reducedDistractionMode"`; HintScaffoldingEnabled bool `json:"hintScaffoldingEnabled"`; MisconceptionDetectionEnabled bool `json:"misconceptionDetectionEnabled"`; RetakePolicy string `json:"retakePolicy"`; MaxAttempts *int32 `json:"maxAttempts,omitempty"`; RemainingAttempts *int32 `json:"remainingAttempts,omitempty"`
}
type QuizAttemptsListResponse struct{ Attempts []QuizAttemptSummary `json:"attempts"`; PolicyScorePercent *float64 `json:"policyScorePercent,omitempty"`; RetakePolicy string `json:"retakePolicy"` }
type QuizAttemptSummary struct{ ID uuid.UUID `json:"id"`; AttemptNumber int32 `json:"attemptNumber"`; SubmittedAt time.Time `json:"submittedAt"`; ScorePercent *float32 `json:"scorePercent,omitempty"`; PointsEarned float64 `json:"pointsEarned"`; PointsPossible float64 `json:"pointsPossible"` }
type EnrollmentQuizOverrideUpsertRequest struct{ QuizID uuid.UUID `json:"quizId"`; ExtraAttempts int32 `json:"extraAttempts"`; TimeMultiplier *float64 `json:"timeMultiplier"` }
type QuizCurrentQuestionResponse struct{ Question *QuizQuestion `json:"question,omitempty"`; QuestionIndex int32 `json:"questionIndex"`; TotalQuestions uint `json:"totalQuestions"`; Completed bool `json:"completed"` }
type QuizAdvanceResponse struct{ Locked bool `json:"locked"`; CurrentQuestionIndex int32 `json:"currentQuestionIndex"`; Completed bool `json:"completed"` }
type QuizFocusLossRequest struct{ EventType string `json:"eventType"`; DurationMS *int32 `json:"durationMs"` }
type QuizFocusLossEventAPI struct{ ID uuid.UUID `json:"id"`; EventType string `json:"eventType"`; DurationMS *int32 `json:"durationMs,omitempty"`; CreatedAt time.Time `json:"createdAt"` }
type QuizFocusLossEventsResponse struct{ Events []QuizFocusLossEventAPI `json:"events"`; Total int64 `json:"total"` }
type QuizAttemptHintRequest struct{}
type QuizHintRevealResponse struct{ Level *int32 `json:"level,omitempty"`; Body *string `json:"body,omitempty"`; MediaURL *string `json:"mediaUrl,omitempty"`; NoMoreHints bool `json:"noMoreHints,omitempty"` }
type QuizWorkedExampleStep struct{ Number int32 `json:"number"`; Explanation string `json:"explanation"`; Expression *string `json:"expression,omitempty"` }
type QuizWorkedExampleResponse struct{ Title *string `json:"title,omitempty"`; Body *string `json:"body,omitempty"`; Steps []QuizWorkedExampleStep `json:"steps"` }
type QuizQuestionResponseItem struct {
	QuestionID string `json:"questionId"`; SelectedChoiceIndex *uint `json:"selectedChoiceIndex"`; SelectedChoiceIndices []uint `json:"selectedChoiceIndices"`; TextAnswer *string `json:"textAnswer"`; MatchingPairs []QuizMatchingPairResponse `json:"matchingPairs"`; OrderingSequence []string `json:"orderingSequence"`; HotspotClick *QuizHotspotClick `json:"hotspotClick"`; NumericValue *float64 `json:"numericValue"`; FormulaLatex *string `json:"formulaLatex"`; CodeSubmission *QuizCodeSubmission `json:"codeSubmission"`; FileKey *string `json:"fileKey"`; AudioKey *string `json:"audioKey"`; VideoKey *string `json:"videoKey"`
}
type QuizMatchingPairResponse struct{ LeftID string `json:"leftId"`; RightID string `json:"rightId"` }
type QuizHotspotClick struct{ X float64 `json:"x"`; Y float64 `json:"y"` }
type QuizCodeSubmission struct{ Language string `json:"language"`; Code string `json:"code"` }
type QuizSubmitRequest struct{ AttemptID uuid.UUID `json:"attemptId"`; Responses []QuizQuestionResponseItem `json:"responses"`; AdaptiveHistory []AdaptiveQuizHistoryTurn `json:"adaptiveHistory"` }
type QuizSubmitResponse struct{ AttemptID uuid.UUID `json:"attemptId"`; PointsEarned float64 `json:"pointsEarned"`; PointsPossible float64 `json:"pointsPossible"`; ScorePercent float32 `json:"scorePercent"` }
type QuizResultsScoreSummary struct{ PointsEarned float64 `json:"pointsEarned"`; PointsPossible float64 `json:"pointsPossible"`; ScorePercent float32 `json:"scorePercent"` }
type QuizMisconceptionResultPayload struct{ ID uuid.UUID `json:"id"`; Name string `json:"name"`; RemediationBody *string `json:"remediationBody,omitempty"`; RemediationURL *string `json:"remediationUrl,omitempty"`; RecurrenceCount int64 `json:"recurrenceCount"` }
type QuizResultsQuestionResult struct {
	QuestionIndex int32 `json:"questionIndex"`; QuestionID *string `json:"questionId,omitempty"`; QuestionType string `json:"questionType"`; PromptSnapshot *string `json:"promptSnapshot,omitempty"`; ResponseJSON json.RawMessage `json:"responseJson"`; IsCorrect *bool `json:"isCorrect,omitempty"`; PointsAwarded *float64 `json:"pointsAwarded,omitempty"`; MaxPoints float64 `json:"maxPoints"`; CorrectChoiceIndex *uint `json:"correctChoiceIndex,omitempty"`; Misconception *QuizMisconceptionResultPayload `json:"misconception,omitempty"`
}
type QuizResultsResponse struct {
	AttemptID uuid.UUID `json:"attemptId"`; AttemptNumber int32 `json:"attemptNumber"`; StartedAt time.Time `json:"startedAt"`; AcademicIntegrityFlag bool `json:"academicIntegrityFlag"`; SubmittedAt *time.Time `json:"submittedAt,omitempty"`; Status string `json:"status"`; IsAdaptive bool `json:"isAdaptive"`; ExtendedTimeActive bool `json:"extendedTimeActive"`; Score *QuizResultsScoreSummary `json:"score,omitempty"`; Questions []QuizResultsQuestionResult `json:"questions,omitempty"`
}
