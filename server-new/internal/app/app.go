// Package app wires configuration, the database, migrations, and the HTTP server.
package app

import (
	"context"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/lextures/lextures/server-new/internal/auth"
	"github.com/lextures/lextures/server-new/internal/background"
	"github.com/lextures/lextures/server-new/internal/commevents"
	"github.com/lextures/lextures/server-new/internal/config"
	"github.com/lextures/lextures/server-new/internal/db"
	"github.com/lextures/lextures/server-new/internal/httpserver"
	"github.com/lextures/lextures/server-new/internal/lti"
	"github.com/lextures/lextures/server-new/internal/migrate"
	"github.com/lextures/lextures/server-new/internal/service/oidcauth"
	"github.com/lextures/lextures/server-new/internal/service/openrouter"
)

// Run starts the API. Pass the migration file tree (e.g. serverdata.Migrations from the module root).
func Run(ctx context.Context, fsys fs.FS) error {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		return err
	}
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("app: database: %w", err)
	}
	defer pool.Close()
	if cfg.RunMigrations {
		if err := migrate.RunWithFS(ctx, fsys, cfg.DatabaseURL); err != nil {
			return err
		}
	}
	background.Start(ctx, pool, cfg)

	ltiRT := lti.NewFromConfig(cfg)
	deps := httpserver.Deps{
		Pool:      pool,
		JWTSigner: auth.NewJWTSigner(cfg.JWTSecret),
		Config:    cfg,
		OIDC:      oidcauth.NewService(cfg),
		Comm:      commevents.New(),
		Lti:       ltiRT,
	}
	if k := strings.TrimSpace(cfg.OpenRouterAPIKey); k != "" {
		deps.OpenRouter = openrouter.NewClient(k)
	}
	srv := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: httpserver.NewHandler(deps),
	}
	slog.Info("http server started", "addr", cfg.HTTPAddr, "port_env", strings.TrimSpace(os.Getenv("PORT")))
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	select {
	case <-ctx.Done():
		shctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = srv.Shutdown(shctx)
		<-errCh
		return nil
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			return err
		}
		return nil
	}
}
