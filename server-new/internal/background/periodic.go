// Package background runs periodic jobs matching server/src/lib.rs (30s tickers).
package background

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/config"
)

// Start launches quiz auto-submit and (when enabled) grade-posting sweeps. Both are
// no-ops in Go until quiz_attempts / course_grades repos and services are ported; the
// tickers and cancellation mirror the Rust `tokio::spawn` loops.
func Start(ctx context.Context, pool *pgxpool.Pool, cfg config.Config) {
	if pool == nil {
		return
	}
	go runEvery(ctx, 30*time.Second, func() {
		sweepExpiredQuizAttempts(context.Background(), pool, cfg, time.Now().UTC())
	})
	go runEvery(ctx, 30*time.Second, func() {
		if !cfg.GradePostingPoliciesEnabled {
			return
		}
		sweepScheduledReleases(context.Background(), pool, cfg, time.Now().UTC())
	})
}

func runEvery(ctx context.Context, d time.Duration, fn func()) {
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			fn()
		}
	}
}

func sweepExpiredQuizAttempts(ctx context.Context, _ *pgxpool.Pool, _ config.Config, _ time.Time) {
	_ = ctx
	// Full parity: services::quiz_auto_submit::sweep_expired_attempts (server/src/services/quiz_auto_submit.rs)
}

func sweepScheduledReleases(ctx context.Context, _ *pgxpool.Pool, _ config.Config, _ time.Time) {
	_ = ctx
	// Full parity: services::grading::posting::sweep_scheduled_releases
}
