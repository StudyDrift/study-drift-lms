package httpserver

import (
	"net/http"
)

func handleHealth() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}
}

// ReadyChecker returns nil when the service is ready to receive traffic.
type ReadyChecker func() error

func handleReady(check ReadyChecker) http.HandlerFunc {
	if check == nil {
		check = func() error { return nil }
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if err := check(); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"status":"not ready"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	}
}
