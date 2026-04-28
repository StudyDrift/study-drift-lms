package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewHandler_RBACSettings_Roles_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/settings/roles", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("settings roles: %d", rr.Code)
	}
}

func TestNewHandler_RBACSettings_Permissions_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/settings/permissions", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("settings permissions: %d", rr.Code)
	}
}

func TestNewHandler_RBACSettings_RoleUsers_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(
		http.MethodGet,
		"/api/v1/settings/roles/00000000-0000-0000-0000-000000000000/users",
		nil,
	)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("role users: %d", rr.Code)
	}
}
