package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdmin_OIDCList_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/oidc/providers", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("oidc: %d", rr.Code)
	}
}

func TestAdmin_SAMLGet_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/saml/config", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("saml: %d", rr.Code)
	}
}

func TestAdmin_SettingsAI_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	for _, p := range []struct {
		path   string
		method string
	}{
		{"/api/v1/settings/ai", http.MethodGet},
		{"/api/v1/settings/ai/models?kind=text", http.MethodGet},
	} {
		rr = httptest.NewRecorder()
		r := httptest.NewRequest(p.method, p.path, nil)
		h.ServeHTTP(rr, r)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("settings AI %s %s: %d", p.method, p.path, rr.Code)
		}
	}
}

func TestAdmin_LTIRegistrationsList_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/lti/registrations", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("lti registrations: %d", rr.Code)
	}
}

func TestNewHandler_AdminRoutesRegistered(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/users/00000000-0000-0000-0000-000000000001/dsar-export", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("dsar: %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	r = httptest.NewRequest(http.MethodPost, "/api/v1/admin/jobs/irt-calibrate", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("irt: %d", rr.Code)
	}
}
