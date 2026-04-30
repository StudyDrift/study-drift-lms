package quizautosubmit

import (
	"context"
	"log/slog"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/repos/quizattempts"
)

const defaultSweepBatch = 200

// SweepExpiredAttempts finalizes timed quiz attempts past deadline (Rust `quiz_auto_submit::sweep_expired_attempts`).
// Non-adaptive mastery updates from `learner_state::apply_mastery_from_saved_responses` are not yet ported in Go;
// scores are still finalized so learners receive credit.
func SweepExpiredAttempts(ctx context.Context, pool *pgxpool.Pool, now time.Time, limit int64) (int, error) {
	if pool == nil {
		return 0, nil
	}
	if limit < 1 {
		limit = defaultSweepBatch
	}
	ids, err := quizattempts.ListExpiredInProgressAttemptIDs(ctx, pool, now, limit)
	if err != nil {
		return 0, err
	}
	var n int
	for _, id := range ids {
		att, err := quizattempts.GetAttemptForSweep(ctx, pool, id)
		if err != nil || att == nil {
			continue
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return n, err
		}
		earned, possible, err := quizattempts.SumResponsePointsForAttempt(ctx, tx, id)
		if err != nil {
			_ = tx.Rollback(ctx)
			return n, err
		}
		// Rust runs question_bank + learner_state here for !is_adaptive; mastery path omitted in Go.
		_ = att.IsAdaptive

		var score float32
		if possible > 0 {
			score = float32(math.Min(100, math.Max(0, (earned/possible)*100)))
		}
		ok, err := quizattempts.FinalizeAttemptAutoSubmitted(ctx, tx, id, now, earned, possible, score)
		if err != nil {
			_ = tx.Rollback(ctx)
			return n, err
		}
		if err := tx.Commit(ctx); err != nil {
			return n, err
		}
		if ok {
			n++
			slog.Info("quiz attempt auto-submitted after deadline", "attempt_id", id)
		}
	}
	return n, nil
}
