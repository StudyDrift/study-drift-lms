package coursemodulequizzes

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/models/coursemodulequiz"
)

// CourseItemQuizRow is the joined structure + module_quizzes row (Rust `CourseItemQuizRow`).
type CourseItemQuizRow struct {
	StructureItemID uuid.UUID
	Title             string
	Markdown          string
	DueAt             *time.Time
	Questions         []coursemodulequiz.QuizQuestion
	UpdatedAt         time.Time

	AvailableFrom               *time.Time
	AvailableUntil              *time.Time
	UnlimitedAttempts           bool
	MaxAttempts                 int32
	GradeAttemptPolicy          string
	PassingScorePercent         *int32
	PointsWorth                 *int32
	LateSubmissionPolicy        string
	LatePenaltyPercent           *int32
	TimeLimitMinutes            *int32
	TimerPauseWhenTabHidden     bool
	PerQuestionTimeLimitSeconds *int32
	ShowScoreTiming             string
	ReviewVisibility            string
	ReviewWhen                  string
	OneQuestionAtATime          bool
	ShuffleQuestions            bool
	ShuffleChoices              bool
	AllowBackNavigation         bool
	QuizAccessCode              *string
	AdaptiveDifficulty          string
	AdaptiveTopicBalance        bool
	AdaptiveStopRule            string
	RandomQuestionPoolCount     *int32
	IsAdaptive                  bool
	AdaptiveSystemPrompt        string
	AdaptiveSourceItemIDs       []uuid.UUID
	AdaptiveQuestionCount       int32
	AdaptiveDeliveryMode        string
	AssignmentGroupID           *uuid.UUID
	LockdownMode                string
	FocusLossThreshold          *int32
	NeverDrop                   bool
	ReplaceWithFinal            bool
}

// QuizRow is an alias kept for callers that only need question JSON from a quiz item.
type QuizRow = CourseItemQuizRow

func InsertEmptyForItem(ctx context.Context, tx pgx.Tx, structureItemID uuid.UUID) error {
	if tx == nil {
		return errors.New("db tx is nil")
	}
	_, err := tx.Exec(ctx, `
INSERT INTO course.module_quizzes (structure_item_id, markdown, updated_at)
VALUES ($1, '', NOW())
`, structureItemID)
	return err
}

// GetForCourseItem loads the quiz module item for a course (full settings + questions).
func GetForCourseItem(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID) (*CourseItemQuizRow, error) {
	var r CourseItemQuizRow
	var questionsJSON, adaptiveSourceJSON []byte
	var quizAccess sql.NullString
	err := pool.QueryRow(ctx, `
SELECT c.id, c.title, m.markdown, c.due_at, m.questions_json, m.updated_at,
       m.available_from, m.available_until, m.unlimited_attempts, m.max_attempts,
       m.grade_attempt_policy, m.passing_score_percent, m.points_worth, m.late_submission_policy, m.late_penalty_percent,
       m.time_limit_minutes, m.timer_pause_when_tab_hidden, m.per_question_time_limit_seconds,
       m.show_score_timing, m.review_visibility, m.review_when,
       m.one_question_at_a_time, m.shuffle_questions, m.shuffle_choices, m.allow_back_navigation,
       m.quiz_access_code, m.adaptive_difficulty, m.adaptive_topic_balance, m.adaptive_stop_rule,
       m.random_question_pool_count,
       m.is_adaptive, m.adaptive_system_prompt, m.adaptive_source_item_ids, m.adaptive_question_count,
       m.adaptive_delivery_mode,
       c.assignment_group_id,
       m.lockdown_mode::text, m.focus_loss_threshold,
       m.never_drop, m.replace_with_final
FROM course.course_structure_items c
INNER JOIN course.module_quizzes m ON m.structure_item_id = c.id
WHERE c.id = $1 AND c.course_id = $2 AND c.kind = 'quiz'
`, itemID, courseID).Scan(
		&r.StructureItemID,
		&r.Title,
		&r.Markdown,
		&r.DueAt,
		&questionsJSON,
		&r.UpdatedAt,
		&r.AvailableFrom,
		&r.AvailableUntil,
		&r.UnlimitedAttempts,
		&r.MaxAttempts,
		&r.GradeAttemptPolicy,
		&r.PassingScorePercent,
		&r.PointsWorth,
		&r.LateSubmissionPolicy,
		&r.LatePenaltyPercent,
		&r.TimeLimitMinutes,
		&r.TimerPauseWhenTabHidden,
		&r.PerQuestionTimeLimitSeconds,
		&r.ShowScoreTiming,
		&r.ReviewVisibility,
		&r.ReviewWhen,
		&r.OneQuestionAtATime,
		&r.ShuffleQuestions,
		&r.ShuffleChoices,
		&r.AllowBackNavigation,
		&quizAccess,
		&r.AdaptiveDifficulty,
		&r.AdaptiveTopicBalance,
		&r.AdaptiveStopRule,
		&r.RandomQuestionPoolCount,
		&r.IsAdaptive,
		&r.AdaptiveSystemPrompt,
		&adaptiveSourceJSON,
		&r.AdaptiveQuestionCount,
		&r.AdaptiveDeliveryMode,
		&r.AssignmentGroupID,
		&r.LockdownMode,
		&r.FocusLossThreshold,
		&r.NeverDrop,
		&r.ReplaceWithFinal,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if quizAccess.Valid && strings.TrimSpace(quizAccess.String) != "" {
		s := strings.TrimSpace(quizAccess.String)
		r.QuizAccessCode = &s
	}
	if len(questionsJSON) > 0 {
		_ = json.Unmarshal(questionsJSON, &r.Questions)
	}
	if len(adaptiveSourceJSON) > 0 {
		_ = json.Unmarshal(adaptiveSourceJSON, &r.AdaptiveSourceItemIDs)
	}
	return &r, nil
}

func UpdateMarkdown(ctx context.Context, pool *pgxpool.Pool, courseID, itemID uuid.UUID, markdown string) (*time.Time, error) {
	var updated time.Time
	err := pool.QueryRow(ctx, `
UPDATE course.module_quizzes q
SET markdown = $3, updated_at = NOW()
FROM course.course_structure_items c
WHERE q.structure_item_id = c.id AND c.course_id = $1 AND c.id = $2 AND c.kind = 'quiz'
RETURNING q.updated_at
`, courseID, itemID, markdown).Scan(&updated)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &updated, nil
}
