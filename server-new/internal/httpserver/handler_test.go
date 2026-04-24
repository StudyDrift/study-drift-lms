package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/StudyDrift/lextures/server-new/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNotImplemented(t *testing.T) {
	rr := httptest.NewRecorder()
	NotImplemented(rr, httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil))
	assert.Equal(t, http.StatusNotImplemented, rr.Code)
	assert.Contains(t, rr.Body.String(), "not_implemented")
}

func TestHealth(t *testing.T) {
	rr := httptest.NewRecorder()
	Health(rr, httptest.NewRequest(http.MethodGet, "/health", nil))
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), "ok")
}

func TestDocsPage(t *testing.T) {
	rr := httptest.NewRecorder()
	DocsPage(rr, httptest.NewRequest(http.MethodGet, "/api/docs", nil))
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), "OpenAPI")
}

func TestOpenAPIDoc(t *testing.T) {
	rr := httptest.NewRecorder()
	OpenAPIDoc(rr, httptest.NewRequest(http.MethodGet, "/api/openapi.json", nil))
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), "openapi")
}

func TestNewRouter_Ready503WithoutDB(t *testing.T) {
	h := NewRouter(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	h.ServeHTTP(rr, r)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestNewRouter_APINotImplemented(t *testing.T) {
	h := NewRouter(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/courses", nil))
	assert.Equal(t, http.StatusNotImplemented, rr.Code)
}

func TestNewRouter_AuthSubtree(t *testing.T) {
	h := NewRouter(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/auth/oidc/google/login", nil))
	assert.Equal(t, http.StatusNotImplemented, rr.Code)
}

func TestNewRouter_WellKnown(t *testing.T) {
	h := NewRouter(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil))
	assert.Equal(t, http.StatusNotImplemented, rr.Code)
}

func TestNewRouter_APIDocs(t *testing.T) {
	h := NewRouter(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/docs", nil))
	assert.Equal(t, http.StatusOK, rr.Code)
	require.NotEmpty(t, rr.Body.String())
}

func TestNewRouter_Root404(t *testing.T) {
	h := NewRouter(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/unknown", nil))
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestCheckReady_CanceledContext(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		if os.Getenv("DATABASE_URL") == "" {
			t.Skip("set TEST_DATABASE_URL for integration test")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	p, err := db.NewPool(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	err = checkReady(ctx, p)
	require.Error(t, err)
}

func TestCORS_Headers(t *testing.T) {
	h := NewRouter(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/health", nil)
	r.Header.Set("Origin", "https://example.com")
	h.ServeHTTP(rr, r)
	aco := rr.Result().Header.Get("Access-Control-Allow-Origin")
	assert.Equal(t, "*", aco)
}
