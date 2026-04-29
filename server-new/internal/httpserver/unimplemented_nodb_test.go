package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUnimplementedV1_learners(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/learners/abc/xyz", nil)
	h.ServeHTTP(rr, r)
	// Learner catch-all 501 removed; unknown subpaths fall through to router 404.
	if rr.Code != http.StatusNotFound {
		t.Fatalf("learners: %d", rr.Code)
	}
}
