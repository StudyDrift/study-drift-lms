package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/StudyDrift/lextures/server-new/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Deps are HTTP-layer dependencies.
type Deps struct {
	Pool *pgxpool.Pool
}

// NewRouter builds the application router, mirroring the route merge order in `server/src/app.rs`
// and permissive CORS (wildcard origin; credentials off because `*` cannot be used with credentials).
func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: false,
		MaxAge:           int(12 * time.Hour.Seconds()),
	}).Handler)
	r.Get("/health", Health)
	r.Get("/health/ready", readyHandler(d.Pool))
	r.Route("/api", func(r chi.Router) {
		r.Get("/openapi.json", OpenAPIDoc)
		r.Get("/docs", DocsPage)
		r.NotFound(NotImplemented)
		r.MethodNotAllowed(NotImplemented)
	})
	r.Get("/.well-known/jwks.json", NotImplemented)
	r.Route("/auth", func(r chi.Router) {
		r.NotFound(NotImplemented)
		r.MethodNotAllowed(NotImplemented)
	})
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})
	return r
}

func readyHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := checkReady(r.Context(), pool); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = writeJSON(w, map[string]any{
				"status": "not_ready",
				"error":  "Database is unreachable or migrations are missing. Ensure Postgres is running and RUN_MIGRATIONS=true (or run migrations manually).",
				"detail": err.Error(),
			})
			return
		}
		w.WriteHeader(http.StatusOK)
		_ = writeJSON(w, map[string]any{
			"status":   "ready",
			"database": "ok",
			"schema":   "course.courses includes hero_image_url (migrations applied)",
		})
	}
}

func checkReady(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return errors.New("database pool is nil")
	}
	return db.Ready(ctx, pool)
}

func writeJSON(w http.ResponseWriter, v any) error {
	return json.NewEncoder(w).Encode(v)
}
