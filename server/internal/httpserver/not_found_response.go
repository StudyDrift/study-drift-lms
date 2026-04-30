// Router-level 404/405: JSON body + clear stderr logs (docker logs).
package httpserver

import (
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/lextures/lextures/server/internal/apierr"
	"log/slog"
)

var httpserverSlog = sync.OnceValue(func() *slog.Logger {
	if s := os.Getenv("HTTP_SLOG"); s == "0" || strings.EqualFold(s, "false") {
		return slog.New(slog.NewTextHandler(&silentWriter{}, &slog.HandlerOptions{}))
	}
	// text to stderr; docker shows this as "server" container logs
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo, AddSource: false}))
})

type silentWriter struct{}

func (silentWriter) Write(p []byte) (n int, err error) { return len(p), nil }

// mountRouterErrorHandlers must run after all route registrations. These handlers run when
// *no* Go route exists (e.g. GET /api/v1/settings/account) — not for handler-level NOT_FOUND
// to a *matched* path (e.g. unknown id).
func (d Deps) mountRouterErrorHandlers(r *chi.Mux) {
	_ = d
	r.NotFound(routerNotFoundHandler)
	r.MethodNotAllowed(routerMethodNotAllowedHandler)
}

func routerNotFoundHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	reqID := requestIDString(r)
	msg := "No HTTP route is registered for this path."
	httpserverSlog().Warn("httpserver: 404 (no Go route: chi has no registered handler; request did not match any r.Get/Post/...)",
		slog.String("method", r.Method),
		slog.String("path", r.URL.Path),
		slog.String("raw_query", r.URL.RawQuery),
		slog.String("remote", r.RemoteAddr),
		slog.String("request_id", reqID),
		slog.String("why", "no matching route; /health and registered /api/* paths return 200/401, not this"),
	)
	apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotImplementedInGo, msg)
}

func requestIDString(r *http.Request) string {
	if id := middleware.GetReqID(r.Context()); id != "" {
		return id
	}
	if id := r.Header.Get("X-Request-Id"); id != "" {
		return id
	}
	return ""
}

func routerMethodNotAllowedHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	httpserverSlog().Warn("httpserver: 405 (this path is registered, but not for this HTTP method)",
		slog.String("method", r.Method),
		slog.String("path", r.URL.Path),
		slog.String("request_id", requestIDString(r)),
		slog.String("why", "e.g. POST to a path that only has GET, or the opposite"),
	)
	apierr.WriteJSON(w, http.StatusMethodNotAllowed, apierr.CodeNotImplementedInGo,
		"HTTP method not allowed: "+r.Method+" "+r.URL.Path+". A route may exist for a different method.")
}
