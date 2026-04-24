// Package app is the top-level service composition layer (config, database, HTTP).
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/StudyDrift/lextures/server-new/internal/config"
	"github.com/StudyDrift/lextures/server-new/internal/db"
	"github.com/StudyDrift/lextures/server-new/internal/httpserver"
	"github.com/StudyDrift/lextures/server-new/internal/migrate"
)

// Run loads configuration, connects to Postgres, optionally runs migrations, and serves HTTP on :8080.
// It blocks until the server context is cancelled or [http.Server.Shutdown] completes.
func Run(ctx context.Context) error {
	config.LoadDotenv()
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.CourseFilesRoot, 0o755); err != nil {
		slog.Warn("could not create course files root", "path", cfg.CourseFilesRoot, "error", err)
	} else {
		slog.Info("course files storage directory ready", "path", cfg.CourseFilesRoot)
	}

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	defer pool.Close()

	if cfg.RunMigrations {
		slog.Info("running database migrations")
		if err := migrate.Apply(ctx, pool); err != nil {
			return fmt.Errorf("migrations: %w", err)
		}
		slog.Info("database migrations applied successfully")
	} else {
		slog.Warn("RUN_MIGRATIONS is disabled; skipping migrations (schema may be out of date)")
	}

	h := httpserver.NewRouter(httpserver.Deps{Pool: pool})
	srv := &http.Server{
		Addr:              ":8080",
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()

	slog.Info("StudyDrift API (Go) listening on :8080")
	select {
	case <-ctx.Done():
		shutCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutCtx); err != nil {
			slog.Warn("http shutdown", "error", err)
		}
		<-errCh
		return nil
	case err := <-errCh:
		if err == nil || errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
