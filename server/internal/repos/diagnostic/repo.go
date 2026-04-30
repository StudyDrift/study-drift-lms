package diagnostic

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CourseDiagnosticRow struct {
	ID             uuid.UUID       `json:"id"`
	CourseID       uuid.UUID       `json:"courseId"`
	ConceptIDs     []uuid.UUID     `json:"conceptIds"`
	MaxItems       int32           `json:"maxItems"`
	StoppingRule   string          `json:"stoppingRule"`
	SEThreshold    float64         `json:"seThreshold"`
	RetakePolicy   string          `json:"retakePolicy"`
	PlacementRules json.RawMessage `json:"placementRules"`
	ThetaCutScores json.RawMessage `json:"thetaCutScores,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

type DiagnosticAttemptRow struct {
	ID               uuid.UUID
	DiagnosticID     uuid.UUID
	EnrollmentID     uuid.UUID
	StartedAt        time.Time
	CompletedAt      *time.Time
	Bypassed         bool
	PlacementItemID  *uuid.UUID
	ThetaSummary     json.RawMessage
	PlacementSummary json.RawMessage
	Responses        json.RawMessage
	SessionState     json.RawMessage
	CreatedAt        time.Time
}

type DiagnosticResultGridRow struct {
	EnrollmentID     uuid.UUID
	UserID           uuid.UUID
	DisplayName      *string
	Email            *string
	AttemptID        *uuid.UUID
	CompletedAt      *time.Time
	Bypassed         *bool
	ThetaSummary     json.RawMessage
	PlacementSummary json.RawMessage
}

func scanDiag(scanner interface{ Scan(...any) error }) (*CourseDiagnosticRow, error) {
	var r CourseDiagnosticRow
	err := scanner.Scan(&r.ID, &r.CourseID, &r.ConceptIDs, &r.MaxItems, &r.StoppingRule, &r.SEThreshold, &r.RetakePolicy, &r.PlacementRules, &r.ThetaCutScores, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func scanAttempt(scanner interface{ Scan(...any) error }) (*DiagnosticAttemptRow, error) {
	var r DiagnosticAttemptRow
	err := scanner.Scan(&r.ID, &r.DiagnosticID, &r.EnrollmentID, &r.StartedAt, &r.CompletedAt, &r.Bypassed, &r.PlacementItemID, &r.ThetaSummary, &r.PlacementSummary, &r.Responses, &r.SessionState, &r.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func GetDiagnosticForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (*CourseDiagnosticRow, error) {
	r, err := scanDiag(pool.QueryRow(ctx, `
SELECT id, course_id, concept_ids, max_items, stopping_rule::text, (se_threshold)::float8, retake_policy, placement_rules, theta_cut_scores, created_at, updated_at
FROM course.course_diagnostics
WHERE course_id = $1
`, courseID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func UpsertCourseDiagnostic(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, conceptIDs []uuid.UUID, maxItems int32, stoppingRule string, seThreshold float64, retakePolicy string, placementRules json.RawMessage, thetaCutScores *json.RawMessage) (*CourseDiagnosticRow, error) {
	return scanDiag(pool.QueryRow(ctx, `
INSERT INTO course.course_diagnostics (
	course_id, concept_ids, max_items, stopping_rule, se_threshold, retake_policy, placement_rules, theta_cut_scores
)
VALUES ($1, $2, $3, $4::course.diagnostic_stopping_rule, $5, $6, $7, $8)
ON CONFLICT (course_id) DO UPDATE SET
	concept_ids = EXCLUDED.concept_ids,
	max_items = EXCLUDED.max_items,
	stopping_rule = EXCLUDED.stopping_rule,
	se_threshold = EXCLUDED.se_threshold,
	retake_policy = EXCLUDED.retake_policy,
	placement_rules = EXCLUDED.placement_rules,
	theta_cut_scores = EXCLUDED.theta_cut_scores,
	updated_at = NOW()
RETURNING id, course_id, concept_ids, max_items, stopping_rule::text, (se_threshold)::float8, retake_policy, placement_rules, theta_cut_scores, created_at, updated_at
`, courseID, conceptIDs, maxItems, stoppingRule, seThreshold, retakePolicy, placementRules, thetaCutScores))
}

func InsertDiagnosticAttempt(ctx context.Context, pool *pgxpool.Pool, diagnosticID, enrollmentID uuid.UUID, sessionState json.RawMessage) (*DiagnosticAttemptRow, error) {
	return scanAttempt(pool.QueryRow(ctx, `
INSERT INTO course.diagnostic_attempts (diagnostic_id, enrollment_id, session_state)
VALUES ($1, $2, $3)
RETURNING id, diagnostic_id, enrollment_id, started_at, completed_at, bypassed, placement_item_id, theta_summary, placement_summary, responses, session_state, created_at
`, diagnosticID, enrollmentID, sessionState))
}

func GetAttemptByID(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID) (*DiagnosticAttemptRow, error) {
	r, err := scanAttempt(pool.QueryRow(ctx, `
SELECT id, diagnostic_id, enrollment_id, started_at, completed_at, bypassed, placement_item_id, theta_summary, placement_summary, responses, session_state, created_at
FROM course.diagnostic_attempts
WHERE id = $1
`, attemptID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func LatestAttemptForEnrollment(ctx context.Context, pool *pgxpool.Pool, diagnosticID, enrollmentID uuid.UUID) (*DiagnosticAttemptRow, error) {
	r, err := scanAttempt(pool.QueryRow(ctx, `
SELECT id, diagnostic_id, enrollment_id, started_at, completed_at, bypassed, placement_item_id, theta_summary, placement_summary, responses, session_state, created_at
FROM course.diagnostic_attempts
WHERE diagnostic_id = $1 AND enrollment_id = $2
ORDER BY started_at DESC
LIMIT 1
`, diagnosticID, enrollmentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func UpdateAttemptSession(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID, sessionState, responses json.RawMessage) error {
	_, err := pool.Exec(ctx, `
UPDATE course.diagnostic_attempts
SET session_state = $2, responses = $3
WHERE id = $1 AND completed_at IS NULL
`, attemptID, sessionState, responses)
	return err
}

func CompleteAttempt(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID, placementItemID *uuid.UUID, thetaSummary, placementSummary, responses json.RawMessage) error {
	_, err := pool.Exec(ctx, `
UPDATE course.diagnostic_attempts
SET completed_at = NOW(), bypassed = FALSE, placement_item_id = $2, theta_summary = $3, placement_summary = $4, responses = $5, session_state = '{}'::jsonb
WHERE id = $1
`, attemptID, placementItemID, thetaSummary, placementSummary, responses)
	return err
}

func BypassAttempt(ctx context.Context, pool *pgxpool.Pool, attemptID uuid.UUID, responses json.RawMessage) error {
	_, err := pool.Exec(ctx, `
UPDATE course.diagnostic_attempts
SET completed_at = NOW(), bypassed = TRUE, placement_item_id = NULL, theta_summary = NULL, placement_summary = NULL, responses = $2, session_state = '{}'::jsonb
WHERE id = $1
`, attemptID, responses)
	return err
}

func InsertBypassedAttempt(ctx context.Context, pool *pgxpool.Pool, diagnosticID, enrollmentID uuid.UUID) (*DiagnosticAttemptRow, error) {
	return scanAttempt(pool.QueryRow(ctx, `
INSERT INTO course.diagnostic_attempts (diagnostic_id, enrollment_id, completed_at, bypassed, responses, session_state)
VALUES ($1, $2, NOW(), TRUE, '[]'::jsonb, '{}'::jsonb)
RETURNING id, diagnostic_id, enrollment_id, started_at, completed_at, bypassed, placement_item_id, theta_summary, placement_summary, responses, session_state, created_at
`, diagnosticID, enrollmentID))
}

func ListDiagnosticResultsForCourse(ctx context.Context, pool *pgxpool.Pool, diagnosticID, courseID uuid.UUID) ([]DiagnosticResultGridRow, error) {
	rows, err := pool.Query(ctx, `
SELECT
	e.id AS enrollment_id, e.user_id, u.display_name, u.email, da.id AS attempt_id, da.completed_at, da.bypassed, da.theta_summary, da.placement_summary
FROM course.course_enrollments e
INNER JOIN "user".users u ON u.id = e.user_id
LEFT JOIN LATERAL (
	SELECT a.*
	FROM course.diagnostic_attempts a
	WHERE a.enrollment_id = e.id AND a.diagnostic_id = $1
	ORDER BY a.started_at DESC
	LIMIT 1
) da ON TRUE
WHERE e.course_id = $2 AND e.role = 'student' AND e.active
ORDER BY COALESCE(u.display_name, u.email, u.id::text) ASC
`, diagnosticID, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DiagnosticResultGridRow, 0)
	for rows.Next() {
		var r DiagnosticResultGridRow
		if err := rows.Scan(&r.EnrollmentID, &r.UserID, &r.DisplayName, &r.Email, &r.AttemptID, &r.CompletedAt, &r.Bypassed, &r.ThetaSummary, &r.PlacementSummary); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
