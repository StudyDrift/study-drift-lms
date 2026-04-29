package learnermodel

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DiagnosticSeed is one concept's post-diagnostic seed (θ, optional SE, mastery, answered count).
type DiagnosticSeed struct {
	ConceptID uuid.UUID
	Theta     float64
	ThetaSE   *float64
	Mastery   float64
	ItemsN    int32
}

// ApplyDiagnosticSeedBatch seeds mastery + θ from a completed diagnostic (Rust `apply_diagnostic_seed_batch`).
func ApplyDiagnosticSeedBatch(ctx context.Context, pool *pgxpool.Pool, userID, diagnosticAttemptID uuid.UUID, seeds []DiagnosticSeed) error {
	if len(seeds) == 0 {
		return nil
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, s := range seeds {
		idem := fmt.Sprintf("diagnostic:%s:%s", diagnosticAttemptID.String(), s.ConceptID.String())
		var newEvent uuid.UUID
		err := tx.QueryRow(ctx, `
INSERT INTO course.learner_concept_events (
  user_id, concept_id, attempt_id, delta, mastery_after, source, idempotency_key
)
VALUES ($1, $2, NULL, 0::numeric, $3::numeric, 'diagnostic_seed', $4)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id
`, userID, s.ConceptID, s.Mastery, idem).Scan(&newEvent)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("learner concept event: %w", err)
		}
		if _, err := tx.Exec(ctx, `
INSERT INTO course.learner_theta_events (user_id, concept_id, attempt_id, theta, theta_se, items_n)
VALUES ($1, $2, NULL, $3::numeric, $4::numeric, $5)
`, userID, s.ConceptID, s.Theta, s.ThetaSE, s.ItemsN); err != nil {
			return fmt.Errorf("learner theta event: %w", err)
		}
		if _, err := tx.Exec(ctx, `
INSERT INTO course.learner_concept_states (
  user_id, concept_id, mastery, attempt_count, theta, theta_se, last_seen_at, updated_at
)
VALUES ($1, $2, $3::numeric, 1, $4::numeric, $5::numeric, NOW(), NOW())
ON CONFLICT (user_id, concept_id) DO UPDATE SET
  mastery = EXCLUDED.mastery,
  theta = EXCLUDED.theta,
  theta_se = EXCLUDED.theta_se,
  attempt_count = course.learner_concept_states.attempt_count + 1,
  last_seen_at = NOW(),
  updated_at = NOW()
`, userID, s.ConceptID, s.Mastery, s.Theta, s.ThetaSE); err != nil {
			return fmt.Errorf("learner concept state: %w", err)
		}
	}
	return tx.Commit(ctx)
}
