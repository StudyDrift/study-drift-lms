package srs

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
	srsrepo "github.com/lextures/lextures/server/internal/repos/srs"
)

func srsPracticeGloballyEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("SRS_PRACTICE_ENABLED")))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func srsActiveForCourse(globalOn, courseFlag bool) bool {
	return globalOn && courseFlag
}

// SubmitReviewBody matches POST /learners/{id}/review JSON.
type SubmitReviewBody struct {
	QuestionID uuid.UUID `json:"questionId"`
	Grade      string    `json:"grade"`
	ResponseMs *int32    `json:"responseMs,omitempty"`
}

type SubmitReviewResponse struct {
	NextReviewAt time.Time `json:"nextReviewAt"`
	IntervalDays float64   `json:"intervalDays"`
}

// ErrSubmitReview is a lightweight error for HTTP mapping.
type ErrSubmitReview struct {
	Code    int
	APICode string
	Msg     string
}

func (e *ErrSubmitReview) Error() string { return e.Msg }

// SubmitReview applies one SRS grade (self-only; parity with server submit_review).
func SubmitReview(ctx context.Context, pool *pgxpool.Pool, actorUserID, targetUserID uuid.UUID, body SubmitReviewBody) (*SubmitReviewResponse, error) {
	if actorUserID != targetUserID {
		return nil, &ErrSubmitReview{Code: 403, APICode: "FORBIDDEN", Msg: "Forbidden."}
	}
	meta, err := srsrepo.GetQuestionSRSMeta(ctx, pool, body.QuestionID)
	if err != nil {
		return nil, err
	}
	if meta == nil {
		return nil, &ErrSubmitReview{Code: 404, APICode: "NOT_FOUND", Msg: "Not found."}
	}
	if !meta.SRSEligible {
		return nil, &ErrSubmitReview{Code: 400, APICode: "INVALID_INPUT", Msg: "This question is not enabled for spaced repetition."}
	}
	if !srsActiveForCourse(srsPracticeGloballyEnabled(), meta.SRSEnabled) {
		return nil, &ErrSubmitReview{Code: 400, APICode: "INVALID_INPUT", Msg: "Spaced repetition is not enabled for this course."}
	}
	ok, err := enrollment.UserHasAccess(ctx, pool, meta.CourseCode, targetUserID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &ErrSubmitReview{Code: 403, APICode: "FORBIDDEN", Msg: "Forbidden."}
	}

	quality, okQ := GradeToQuality(body.Grade)
	if !okQ {
		return nil, &ErrSubmitReview{Code: 400, APICode: "INVALID_INPUT", Msg: "Invalid grade."}
	}
	gradeDB := strings.ToLower(strings.TrimSpace(body.Grade))

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	locked, err := srsrepo.LockStateForUserQuestion(ctx, tx, targetUserID, body.QuestionID)
	if err != nil {
		return nil, err
	}
	prev := DefaultSm2State()
	if locked != nil {
		prev = Sm2State{
			EasinessFactor: locked.EasinessFactor,
			Repetition:     locked.Repetition,
			IntervalDays:   locked.IntervalDays,
		}
	}
	wasOverdue := locked != nil && !locked.NextReviewAt.After(time.Now().UTC())
	dueIncrement := int32(0)
	if wasOverdue {
		dueIncrement = 1
	}

	nextSM2 := Sm2Step(prev, quality)
	now := time.Now().UTC()
	secs := int64(nextSM2.IntervalDays*86400.0 + 0.5)
	nextReviewAt := now.Add(time.Duration(secs) * time.Second)

	var intervalBefore, efBefore *float64
	if locked != nil {
		intervalBefore = &locked.IntervalDays
		efBefore = &locked.EasinessFactor
	}

	_, err = srsrepo.InsertReviewEvent(ctx, tx, targetUserID, body.QuestionID, gradeDB, intervalBefore, nextSM2.IntervalDays, efBefore, nextSM2.EasinessFactor, body.ResponseMs)
	if err != nil {
		return nil, err
	}

	if err := srsrepo.UpsertSRSState(ctx, tx, targetUserID, body.QuestionID, nextSM2.IntervalDays, nextSM2.Repetition, nextSM2.EasinessFactor, nextReviewAt, dueIncrement); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	remaining, err := srsrepo.CountDueForUser(ctx, pool, targetUserID)
	if err != nil {
		return nil, err
	}
	if remaining == 0 {
		day := time.Now().UTC()
		_ = srsrepo.InsertStreakDay(ctx, pool, targetUserID, day)
	}

	return &SubmitReviewResponse{
		NextReviewAt: nextReviewAt,
		IntervalDays: nextSM2.IntervalDays,
	}, nil
}
