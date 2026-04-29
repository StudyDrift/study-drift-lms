package learnermodel

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ConceptStateRow matches learner concept state joined to concept name (Rust LearnerConceptStateRow).
type ConceptStateRow struct {
	ConceptID        uuid.UUID
	ConceptName      string
	StoredMastery    float64
	MasteryEffective float64
	AttemptCount     int32
	LastSeenAt       *time.Time
	NeedsReviewAt    *time.Time
}

// ListConceptStatesForUser lists all concept mastery rows for a learner (optional concept id filter).
func ListConceptStatesForUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, conceptIDs []uuid.UUID) ([]ConceptStateRow, error) {
	var (
		rows pgx.Rows
		err  error
	)
	if len(conceptIDs) > 0 {
		rows, err = pool.Query(ctx, `
SELECT
	c.id AS concept_id,
	c.name AS concept_name,
	(s.mastery)::float8 AS stored_mastery,
	(
		CASE
			WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
			ELSE LEAST(1.0, GREATEST(0.0,
				(s.mastery)::float8 * exp(
					-(c.decay_lambda)::float8
					* (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
				)
			))
		END
	) AS mastery_effective,
	s.attempt_count,
	s.last_seen_at,
	s.needs_review_at
FROM course.learner_concept_states s
INNER JOIN course.concepts c ON c.id = s.concept_id
WHERE s.user_id = $1 AND s.concept_id = ANY($2::uuid[])
ORDER BY c.name ASC
`, userID, conceptIDs)
	} else {
		rows, err = pool.Query(ctx, `
SELECT
	c.id AS concept_id,
	c.name AS concept_name,
	(s.mastery)::float8 AS stored_mastery,
	(
		CASE
			WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
			ELSE LEAST(1.0, GREATEST(0.0,
				(s.mastery)::float8 * exp(
					-(c.decay_lambda)::float8
					* (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
				)
			))
		END
	) AS mastery_effective,
	s.attempt_count,
	s.last_seen_at,
	s.needs_review_at
FROM course.learner_concept_states s
INNER JOIN course.concepts c ON c.id = s.concept_id
WHERE s.user_id = $1
ORDER BY c.name ASC
`, userID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanConceptStateRows(rows)
}

// GetConceptStateForUser returns one row or nil if no state exists.
func GetConceptStateForUser(ctx context.Context, pool *pgxpool.Pool, userID, conceptID uuid.UUID) (*ConceptStateRow, error) {
	var r ConceptStateRow
	err := pool.QueryRow(ctx, `
SELECT
	c.id AS concept_id,
	c.name AS concept_name,
	(s.mastery)::float8 AS stored_mastery,
	(
		CASE
			WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
			ELSE LEAST(1.0, GREATEST(0.0,
				(s.mastery)::float8 * exp(
					-(c.decay_lambda)::float8
					* (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
				)
			))
		END
	) AS mastery_effective,
	s.attempt_count,
	s.last_seen_at,
	s.needs_review_at
FROM course.learner_concept_states s
INNER JOIN course.concepts c ON c.id = s.concept_id
WHERE s.user_id = $1 AND s.concept_id = $2
`, userID, conceptID).Scan(&r.ConceptID, &r.ConceptName, &r.StoredMastery, &r.MasteryEffective, &r.AttemptCount, &r.LastSeenAt, &r.NeedsReviewAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ThetaMetaRow is θ metadata from learner_concept_states.
type ThetaMetaRow struct {
	Theta       *float64
	ThetaSE     *float64
	LastUpdated *time.Time
}

func GetLearnerThetaMeta(ctx context.Context, pool *pgxpool.Pool, userID, conceptID uuid.UUID) (*ThetaMetaRow, error) {
	var theta, thetaSE *float64
	var updatedAt *time.Time
	err := pool.QueryRow(ctx, `
SELECT (theta)::float8, (theta_se)::float8, updated_at
FROM course.learner_concept_states
WHERE user_id = $1 AND concept_id = $2
`, userID, conceptID).Scan(&theta, &thetaSE, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &ThetaMetaRow{Theta: theta, ThetaSE: thetaSE, LastUpdated: updatedAt}, nil
}

// BatchListConceptStatesForUsers returns (user_id, row) pairs for reporting (max first n user ids).
func BatchListConceptStatesForUsers(ctx context.Context, pool *pgxpool.Pool, userIDs []uuid.UUID, conceptIDs []uuid.UUID, limitUsers int) ([]struct {
	UserID uuid.UUID
	Row    ConceptStateRow
}, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	n := len(userIDs)
	if n > limitUsers {
		n = limitUsers
	}
	slice := userIDs[:n]

	var rows pgx.Rows
	var err error
	if len(conceptIDs) > 0 {
		rows, err = pool.Query(ctx, `
SELECT
	s.user_id,
	c.id AS concept_id,
	c.name AS concept_name,
	(s.mastery)::float8 AS stored_mastery,
	(
		CASE
			WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
			ELSE LEAST(1.0, GREATEST(0.0,
				(s.mastery)::float8 * exp(
					-(c.decay_lambda)::float8
					* (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
				)
			))
		END
	) AS mastery_effective,
	s.attempt_count,
	s.last_seen_at,
	s.needs_review_at
FROM course.learner_concept_states s
INNER JOIN course.concepts c ON c.id = s.concept_id
WHERE s.user_id = ANY($1::uuid[]) AND s.concept_id = ANY($2::uuid[])
ORDER BY s.user_id, c.name ASC
`, slice, conceptIDs)
	} else {
		rows, err = pool.Query(ctx, `
SELECT
	s.user_id,
	c.id AS concept_id,
	c.name AS concept_name,
	(s.mastery)::float8 AS stored_mastery,
	(
		CASE
			WHEN s.last_seen_at IS NULL THEN (s.mastery)::float8
			ELSE LEAST(1.0, GREATEST(0.0,
				(s.mastery)::float8 * exp(
					-(c.decay_lambda)::float8
					* (EXTRACT(EPOCH FROM (NOW() - s.last_seen_at)) / 86400.0)
				)
			))
		END
	) AS mastery_effective,
	s.attempt_count,
	s.last_seen_at,
	s.needs_review_at
FROM course.learner_concept_states s
INNER JOIN course.concepts c ON c.id = s.concept_id
WHERE s.user_id = ANY($1::uuid[])
ORDER BY s.user_id, c.name ASC
`, slice)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		UserID uuid.UUID
		Row    ConceptStateRow
	}
	for rows.Next() {
		var uid uuid.UUID
		var r ConceptStateRow
		if err := rows.Scan(&uid, &r.ConceptID, &r.ConceptName, &r.StoredMastery, &r.MasteryEffective, &r.AttemptCount, &r.LastSeenAt, &r.NeedsReviewAt); err != nil {
			return nil, err
		}
		out = append(out, struct {
			UserID uuid.UUID
			Row    ConceptStateRow
		}{UserID: uid, Row: r})
	}
	return out, rows.Err()
}

func scanConceptStateRows(rows pgx.Rows) ([]ConceptStateRow, error) {
	var out []ConceptStateRow
	for rows.Next() {
		var r ConceptStateRow
		if err := rows.Scan(&r.ConceptID, &r.ConceptName, &r.StoredMastery, &r.MasteryEffective, &r.AttemptCount, &r.LastSeenAt, &r.NeedsReviewAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
