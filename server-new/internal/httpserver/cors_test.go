package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSAll_Options(t *testing.T) {
	called := false
	h := corsAll(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(200) }))
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodOptions, "/x", nil)
	h.ServeHTTP(rr, r)
	if called {
		t.Fatalf("inner handler should not run for OPTIONS")
	}
	if rr.Code != http.StatusNoContent {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestCORSAll_Passthrough(t *testing.T) {
	called := false
	h := corsAll(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(201) }))
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	h.ServeHTTP(rr, r)
	if !called {
		t.Fatalf("inner handler not called")
	}
	if rr.Code != 201 {
		t.Fatalf("code: %d", rr.Code)
	}
}
