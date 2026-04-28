package httpserver

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// registerUnimplementedV1 adds HTTP 501 for unported /api/v1 sub-trees (migration.md §2).
// Registered after concrete routes; does not include /api/v1/courses/... (partial port).
func (d Deps) registerUnimplementedV1(r *chi.Mux) {
	_ = d
	h := http.HandlerFunc(http501Handler)
	prefixes := []string{
		// Not /api/v1/enrollments: accommodations uses /api/v1/enrollments/{id}/accommodation-summary
		"/api/v1/learners",
		"/api/v1/concepts",
		"/api/v1/misconceptions",
		"/api/v1/diagnostic-attempts",
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
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code":  "NOT_IMPLEMENTED_IN_GO",
		"error": "This API area is not implemented in the Go server yet. See server-new/migration.md.",
	})
}
