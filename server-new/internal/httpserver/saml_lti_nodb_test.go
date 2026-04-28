package httpserver

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lextures/lextures/server-new/internal/config"
	"github.com/lextures/lextures/server-new/internal/lti"
)

func TestNewHandler_JWKS_ltiOff(t *testing.T) {
	h := NewHandler(Deps{Config: config.Config{LTIEnabled: false}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("jwks: %d %s", rr.Code, rr.Body.String())
	}
}

func TestNewHandler_SAML_slo_501(t *testing.T) {
	h := NewHandler(Deps{Config: config.Config{}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/auth/saml/slo", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusNotImplemented {
		t.Fatalf("slo: %d", rr.Code)
	}
}

func TestNewHandler_SAML_metadata_OKWhenEnabled(t *testing.T) {
	h := NewHandler(Deps{Config: config.Config{
		SAMLSSOEnabled: true,
		SAMLSPX509PEM:  "x",
		SAMLPublicBaseURL: "https://sp.example.com",
		SAMLSPEntityID:  "https://sp.example.com/auth/saml/metadata",
	}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/auth/saml/metadata", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusOK {
		t.Fatalf("metadata: %d %s", rr.Code, rr.Body.String())
	}
	b := rr.Body.String()
	if !strings.Contains(b, "EntityDescriptor") || !strings.Contains(b, "SPSSODescriptor") {
		t.Fatalf("expected SP metadata XML, got: %s", b)
	}
}

func TestNewHandler_JWKS_okWhenLti(t *testing.T) {
	pk, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(pk)
	if err != nil {
		t.Fatal(err)
	}
	pemS := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	pair, err := lti.FromPKCS8PEM(pemS, "k1")
	if err != nil {
		t.Fatal(err)
	}
	h := NewHandler(Deps{
		Config: config.Config{LTIEnabled: true, LTIRSAPrivateKeyPEM: pemS, LTIRSAKeyID: "k1", LTIAPIBaseURL: "http://x"},
		Lti:    &lti.Runtime{Enabled: true, Keys: pair, APIBaseURL: "http://x"},
	})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != 200 {
		t.Fatalf("jwks: %d %s", rr.Code, rr.Body.String())
	}
}

func TestNewHandler_LtiProviderLogin_LtiOff(t *testing.T) {
	h := NewHandler(Deps{Config: config.Config{}})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/lti/provider/login", nil)
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	h.ServeHTTP(rr, r)
	// LTI disabled → 400 (parity with Rust require_lti), not 501.
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("lti: %d %s", rr.Code, rr.Body.String())
	}
}
