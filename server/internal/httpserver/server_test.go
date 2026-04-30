package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewHandler_Health(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/health", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("health: %d", rr.Code)
	}
}

func TestNewHandler_ReadyNilPool(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("ready: %d", rr.Code)
	}
}

func TestDegradedErr(t *testing.T) {
	e := &degradedErr{s: "x"}
	if e.Error() != "x" {
		t.Fatalf("Error: %q", e.Error())
	}
}

func TestNewHandler_CORSAndOpenAPI(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})

	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodOptions, "/api/any", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS: %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("cors origin: %q", rr.Header().Get("Access-Control-Allow-Origin"))
	}

	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/openapi.json", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("openapi.json: %d", rr.Code)
	}
	if rr.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("get cors: %q", rr.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestNewHandler_AuthStubs(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/status", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("saml status: %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/status", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("oidc status: %d", rr.Code)
	}
}

func TestNewHandler_MePermissionsUnauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/permissions", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("me: %d", rr.Code)
	}
}

func TestNewHandler_MeAccommodationsUnauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/accommodations", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("me accommodations: %d", rr.Code)
	}
}

func TestNewHandler_CourseContextUnauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/courses/C-AB0000/course-context", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("course-context: %d", rr.Code)
	}
}

func TestNewHandler_MeOIDCIdentitiesUnauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/me/oidc-identities", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("me oidc: %d", rr.Code)
	}
}

func TestNewHandler_OIDCLogin_NilDB(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/auth/oidc/google/login", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("oidc login: %d", rr.Code)
	}
}
