package httpserver

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleHealth(t *testing.T) {
	rr := httptest.NewRecorder()
	handleHealth()(rr, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("code %d", rr.Code)
	}
}

func TestHandleReady_OK(t *testing.T) {
	rr := httptest.NewRecorder()
	check := func() error { return nil }
	handleReady(check)(rr, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("code %d", rr.Code)
	}
}

func TestHandleReady_NilChecker(t *testing.T) {
	rr := httptest.NewRecorder()
	handleReady(nil)(rr, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("code %d", rr.Code)
	}
}

func TestHandleReady_Fail(t *testing.T) {
	rr := httptest.NewRecorder()
	check := func() error { return errors.New("nope") }
	handleReady(check)(rr, httptest.NewRequest(http.MethodGet, "/health/ready", nil))
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("code %d", rr.Code)
	}
}
