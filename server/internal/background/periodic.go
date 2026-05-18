// Package background runs periodic jobs matching server/src/lib.rs (30s tickers).
package background

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/repos/orgroles"
	"github.com/lextures/lextures/server/internal/repos/terms"
	"github.com/lextures/lextures/server/internal/service/quizautosubmit"
)

// Start launches quiz auto-submit and (when enabled) grade-posting sweeps on a 30s ticker
// (Rust `server/src/lib.rs`).
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
	go runEvery(ctx, 30*time.Second, func() {
		n, err := terms.SweepStatuses(context.Background(), pool, time.Now().UTC())
		if err != nil {
			slog.Warn("term status sweep failed", "err", err)
			return
		}
		if n > 0 {
			slog.Info("term status sweep updated rows", "count", n)
		}
	})
	go runEvery(ctx, 30*time.Second, func() {
		n, err := orgroles.SweepExpired(context.Background(), pool, time.Now().UTC(), 200)
		if err != nil {
			slog.Warn("org role grant sweep failed", "err", err)
			return
		}
		if n > 0 {
			slog.Info("org role grant sweep deleted rows", "count", n)
		}
	})
	go runEvery(ctx, 15*time.Second, func() {
		now := time.Now().UTC()
		sweepEmailJobs(context.Background(), pool, cfg, now)
	})
	go runEvery(ctx, time.Minute, func() {
		sweepDailyDigests(context.Background(), pool, cfg, time.Now().UTC())
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

func sweepExpiredQuizAttempts(ctx context.Context, pool *pgxpool.Pool, _ config.Config, now time.Time) {
	n, err := quizautosubmit.SweepExpiredAttempts(ctx, pool, now, 200)
	if err != nil {
		slog.Warn("auto-submit sweep failed", "err", err)
		return
	}
	if n > 0 {
		slog.Info("auto-submit sweep completed", "count", n)
	}
}
