package learnermodel

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RecordLearnerThetaSnapshot appends to learner theta events and upserts learner_concept_states
// (port of `record_learner_theta_snapshot` in server `repos/learner_model.rs`).
func RecordLearnerThetaSnapshot(
	ctx context.Context,
	pool *pgxpool.Pool,
	userID, conceptID, attemptID uuid.UUID,
	theta float64,
	thetaSE *float64,
	itemsN int32,
) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `
INSERT INTO course.learner_theta_events (user_id, concept_id, attempt_id, theta, theta_se, items_n)
VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6)
`, userID, conceptID, attemptID, theta, thetaSE, itemsN); err != nil {
		return fmt.Errorf("learner theta event: %w", err)
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO course.learner_concept_states (user_id, concept_id, mastery, attempt_count, theta, theta_se, updated_at)
VALUES ($1, $2, 0::numeric, 0, $3::numeric, $4::numeric, NOW())
ON CONFLICT (user_id, concept_id) DO UPDATE SET
	theta = EXCLUDED.theta,
	theta_se = EXCLUDED.theta_se,
	updated_at = NOW()
`, userID, conceptID, theta, thetaSE); err != nil {
		return fmt.Errorf("learner concept state theta: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}
