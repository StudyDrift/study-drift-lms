package httpserver

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/lextures/lextures/server/internal/apierr"
)

// registerUnimplementedV1 adds HTTP 501 for unported /api/v1 sub-trees.
// Registered after concrete routes; does not include /api/v1/courses/... (partial port).
func (d Deps) registerUnimplementedV1(r *chi.Mux) {
	_ = d
	h := http.HandlerFunc(http501Handler)
	prefixes := []string{
		// Intentionally empty: remaining legacy 501 areas register their own routes when ported.
	}
	for _, p := range prefixes {
		r.Handle(p, h)
		r.Handle(p+"/*", h)
	}
}

func http501Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	apierr.WriteJSON(w, http.StatusNotImplemented, apierr.CodeNotImplemented,
		"This API area is not implemented yet.")
}
