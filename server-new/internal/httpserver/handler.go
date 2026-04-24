package httpserver

import (
	"encoding/json"
	"net/http"
)

// NotImplemented is returned for API routes that have not been ported from Rust yet.
func NotImplemented(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":   "not_implemented",
		"message": "This endpoint is not yet implemented in the Go service build.",
		"path":    r.URL.Path,
		"method":  r.Method,
	})
}

// Health is the liveness handler (`GET /health`).
func Health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"service": "StudyDrift",
	})
}

// OpenAPIDoc returns a minimal OpenAPI 3 spec for `/api/openapi.json` (expand as handlers are ported).
func OpenAPIDoc(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	doc := map[string]any{
		"openapi": "3.0.0",
		"info": map[string]any{
			"title":       "StudyDrift API (Go)",
			"version":     "0.1.0",
			"description": "Lextures LMS HTTP API (Go implementation in progress).",
		},
		"paths": map[string]any{
			"/health": map[string]any{
				"get": map[string]any{
					"summary":     "Liveness",
					"operationId": "healthGet",
					"tags":        []string{"meta"},
					"responses": map[string]any{
						"200": map[string]any{"description": "OK"},
					},
				},
			},
		},
	}
	_ = json.NewEncoder(w).Encode(doc)
}

// DocsPage is a tiny HTML page so `/api/docs` is discoverable before Swagger UI is embedded.
func DocsPage(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`<!doctype html><html><head><meta charset="utf-8"><title>StudyDrift API</title></head>
<body><h1>StudyDrift API (Go)</h1><p><a href="/api/openapi.json">OpenAPI document</a></p></body></html>`))
}
