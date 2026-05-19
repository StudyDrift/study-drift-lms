package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lextures/lextures/server/internal/auth"
)

func TestVirtualMeetings_Unauthenticated(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/courses/C-TEST/meetings"},
		{http.MethodGet, "/api/v1/courses/C-TEST/meetings"},
		{http.MethodGet, "/api/v1/meetings/00000000-0000-0000-0000-000000000001/join"},
		{http.MethodPatch, "/api/v1/meetings/00000000-0000-0000-0000-000000000001"},
		{http.MethodGet, "/api/v1/meetings/00000000-0000-0000-0000-000000000001/attendance"},
		{http.MethodGet, "/api/v1/meetings/00000000-0000-0000-0000-000000000001/ical"},
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(c.method, c.path, nil)
		h.ServeHTTP(rr, r)
		if rr.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: want 401, got %d", c.method, c.path, rr.Code)
		}
	}
}

func TestVirtualMeetings_RoutesRegistered(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: signer})
	// These routes must not return 405 Method Not Allowed (which indicates the path was not registered).
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/courses/C-TEST/meetings"},
		{http.MethodGet, "/api/v1/courses/C-TEST/meetings"},
		{http.MethodGet, "/api/v1/meetings/00000000-0000-0000-0000-000000000001/join"},
		{http.MethodPatch, "/api/v1/meetings/00000000-0000-0000-0000-000000000001"},
		{http.MethodGet, "/api/v1/meetings/00000000-0000-0000-0000-000000000001/attendance"},
		{http.MethodGet, "/api/v1/meetings/00000000-0000-0000-0000-000000000001/ical"},
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(c.method, c.path, nil)
		h.ServeHTTP(rr, r)
		if rr.Code == http.StatusMethodNotAllowed {
			t.Errorf("%s %s: route not registered (got 405)", c.method, c.path)
		}
	}
}
