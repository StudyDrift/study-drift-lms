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
	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("learners: %d", rr.Code)
	}
}
