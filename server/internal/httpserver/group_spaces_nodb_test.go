package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lextures/lextures/server/internal/auth"
)

// TestGroupSpaces_Unauthenticated verifies that all group-spaces routes return 401 when there
// is no valid JWT present (i.e. the standard requireCourseAccess guard fires first).
func TestGroupSpaces_Unauthenticated(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/courses/C-TEST/groups"},
		{http.MethodGet, "/api/v1/courses/C-TEST/my-groups"},
		{http.MethodGet, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels"},
		{http.MethodPost, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels"},
		{http.MethodGet, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels/00000000-0000-0000-0000-000000000002/messages"},
		{http.MethodPost, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels/00000000-0000-0000-0000-000000000002/messages"},
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

// TestGroupSpaces_RoutesRegistered verifies that all group-spaces routes are registered (do not
// return 405 Method Not Allowed, which would indicate the path is not registered in chi).
func TestGroupSpaces_RoutesRegistered(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: signer})
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/courses/C-TEST/groups"},
		{http.MethodGet, "/api/v1/courses/C-TEST/my-groups"},
		{http.MethodGet, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels"},
		{http.MethodPost, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels"},
		{http.MethodGet, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels/00000000-0000-0000-0000-000000000002/messages"},
		{http.MethodPost, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels/00000000-0000-0000-0000-000000000002/messages"},
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

// TestGroupSpaces_MethodNotAllowed verifies that wrong HTTP methods return 405.
func TestGroupSpaces_MethodNotAllowed(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: signer})
	cases := []struct {
		method string
		path   string
	}{
		// These routes are GET-only; POST/DELETE should 405.
		{http.MethodPost, "/api/v1/courses/C-TEST/groups"},
		{http.MethodDelete, "/api/v1/courses/C-TEST/groups"},
		{http.MethodPost, "/api/v1/courses/C-TEST/my-groups"},
		{http.MethodDelete, "/api/v1/courses/C-TEST/my-groups"},
		// Message list is GET-only.
		{http.MethodDelete, "/api/v1/courses/C-TEST/groups/00000000-0000-0000-0000-000000000001/feed/channels/00000000-0000-0000-0000-000000000002/messages"},
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		r := httptest.NewRequest(c.method, c.path, nil)
		h.ServeHTTP(rr, r)
		if rr.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s: want 405, got %d", c.method, c.path, rr.Code)
		}
	}
}
