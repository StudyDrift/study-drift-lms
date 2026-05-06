// Package app wires configuration, the database, migrations, and the HTTP server.
package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/background"
	"github.com/lextures/lextures/server/internal/commevents"
	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/db"
	"github.com/lextures/lextures/server/internal/httpserver"
	"github.com/lextures/lextures/server/internal/lti"
	"github.com/lextures/lextures/server/internal/migrate"
	"github.com/lextures/lextures/server/internal/platformstate"
	"github.com/lextures/lextures/server/internal/repos/orgbranding"
	"github.com/lextures/lextures/server/internal/repos/platformconfig"
	"github.com/lextures/lextures/server/internal/service/oidcauth"
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

	dbPlatform, err := platformconfig.Get(ctx, pool)
	if err != nil {
		// Integration tests (and some local workflows) set RUN_MIGRATIONS=false against an
		// empty database, so migration 118 never creates settings.platform_app_settings.
		// Treat a missing table like "no DB overrides" instead of failing startup.
		if cfg.RunMigrations || !isUndefinedTable(err) {
			return fmt.Errorf("app: platform settings: %w", err)
		}
		dbPlatform = nil
	}
	merged := platformconfig.Merge(cfg, dbPlatform)
	if err := merged.Validate(); err != nil {
		return fmt.Errorf("app: effective configuration invalid (environment + database settings): %w", err)
	}

	background.Start(ctx, pool, merged)

	ltiRT := lti.NewFromConfig(merged)
	brandingResolver := orgbranding.NewResolver(pool, merged.BrandingMultitenantHostSuffix, webHostFromOrigin(merged.PublicWebOrigin))
	deps := httpserver.Deps{
		Pool:               pool,
		JWTSigner:          auth.NewJWTSignerWithPool(cfg.JWTSecret, pool),
		Config:             cfg,
		Platform:           platformstate.New(merged),
		OIDC:               oidcauth.NewService(merged),
		Comm:               commevents.New(),
		Lti:                ltiRT,
		BrandingResolver:   brandingResolver,
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

func isUndefinedTable(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "42P01"
}

func webHostFromOrigin(origin string) string {
	u, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || u.Host == "" {
		return ""
	}
	return orgbranding.NormalizeHost(u.Host)
}
