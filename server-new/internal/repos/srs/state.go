package srs

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ItemStateRow struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	QuestionID       uuid.UUID
	Algorithm        string
	IntervalDays     float64
	Repetition       int32
	EasinessFactor   float64
	NextReviewAt     time.Time
	DueCount         int32
	SuppressedUntil  *time.Time
}

type QuestionSRSMeta struct {
	CourseID     uuid.UUID
	SRSEligible  bool
	SRSEnabled   bool
	CourseCode   string
}

func CountDueUntil(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, until time.Time) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `
SELECT COUNT(*)::bigint
FROM course.srs_item_states s
INNER JOIN course.questions q ON q.id = s.question_id
INNER JOIN course.courses c ON c.id = q.course_id
INNER JOIN course.course_enrollments e ON e.course_id = q.course_id AND e.user_id = s.user_id
WHERE s.user_id = $1
  AND c.srs_enabled = TRUE
  AND q.srs_eligible = TRUE
  AND s.next_review_at <= $2
  AND (s.suppressed_until IS NULL OR s.suppressed_until < NOW())
`, userID, until).Scan(&n)
	return n, err
}

func AvgEasinessForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) (*float64, error) {
	var v *float64
	err := pool.QueryRow(ctx, `
SELECT AVG((s.easiness_factor)::float8)
FROM course.srs_item_states s
INNER JOIN course.questions q ON q.id = s.question_id
INNER JOIN course.courses c ON c.id = q.course_id
WHERE s.user_id = $1 AND c.srs_enabled = TRUE AND q.srs_eligible = TRUE
`, userID).Scan(&v)
	if err != nil {
		return nil, err
	}
	return v, nil
}

func utcDay(d time.Time) time.Time {
	d = d.UTC()
	return time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC)
}

func HasStreakDay(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, day time.Time) (bool, error) {
	d := utcDay(day)
	var uid uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT user_id FROM course.srs_streak_days WHERE user_id = $1 AND day_utc = $2::date
`, userID, d).Scan(&uid)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func InsertStreakDay(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, day time.Time) error {
	d := utcDay(day)
	_, err := pool.Exec(ctx, `
INSERT INTO course.srs_streak_days (user_id, day_utc)
VALUES ($1, $2::date)
ON CONFLICT DO NOTHING
`, userID, d)
	return err
}

func GetQuestionSRSMeta(ctx context.Context, pool *pgxpool.Pool, questionID uuid.UUID) (*QuestionSRSMeta, error) {
	var r QuestionSRSMeta
	err := pool.QueryRow(ctx, `
SELECT q.course_id, q.srs_eligible, c.srs_enabled, c.course_code
FROM course.questions q
INNER JOIN course.courses c ON c.id = q.course_id
WHERE q.id = $1
`, questionID).Scan(&r.CourseID, &r.SRSEligible, &r.SRSEnabled, &r.CourseCode)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func LockStateForUserQuestion(ctx context.Context, tx pgx.Tx, userID, questionID uuid.UUID) (*ItemStateRow, error) {
	var r ItemStateRow
	err := tx.QueryRow(ctx, `
SELECT
	s.id,
	s.user_id,
	s.question_id,
	s.algorithm::text,
	(s.interval_days)::float8,
	s.repetition,
	(s.easiness_factor)::float8,
	s.next_review_at,
	s.due_count,
	s.suppressed_until
FROM course.srs_item_states s
WHERE s.user_id = $1 AND s.question_id = $2
FOR UPDATE
`, userID, questionID).Scan(
		&r.ID, &r.UserID, &r.QuestionID, &r.Algorithm, &r.IntervalDays, &r.Repetition, &r.EasinessFactor, &r.NextReviewAt, &r.DueCount, &r.SuppressedUntil,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func InsertReviewEvent(ctx context.Context, tx pgx.Tx, userID, questionID uuid.UUID, grade string, intervalBefore *float64, intervalAfter float64, efBefore *float64, efAfter float64, responseMs *int32) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
INSERT INTO course.srs_review_events (
	user_id, question_id, grade, interval_before, interval_after,
	ef_before, ef_after, response_ms
)
VALUES (
	$1, $2, $3::course.srs_grade, $4::numeric, $5::numeric,
	$6::numeric, $7::numeric, $8
)
RETURNING id
`, userID, questionID, grade, intervalBefore, intervalAfter, efBefore, efAfter, responseMs).Scan(&id)
	return id, err
}

func UpsertSRSState(ctx context.Context, tx pgx.Tx, userID, questionID uuid.UUID, intervalDays float64, repetition int32, easinessFactor float64, nextReviewAt time.Time, dueIncrement int32) error {
	_, err := tx.Exec(ctx, `
INSERT INTO course.srs_item_states (
	user_id, question_id, algorithm, interval_days, repetition,
	easiness_factor, next_review_at, due_count, updated_at
)
VALUES (
	$1, $2, 'sm2'::course.srs_algorithm, $3::numeric, $4,
	$5::numeric, $6, 0, NOW()
)
ON CONFLICT (user_id, question_id) DO UPDATE SET
	interval_days = EXCLUDED.interval_days,
	repetition = EXCLUDED.repetition,
	easiness_factor = EXCLUDED.easiness_factor,
	next_review_at = EXCLUDED.next_review_at,
	due_count = course.srs_item_states.due_count + $7,
	updated_at = NOW()
`, userID, questionID, intervalDays, repetition, easinessFactor, nextReviewAt, dueIncrement)
	return err
}
