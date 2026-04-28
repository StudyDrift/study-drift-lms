package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lextures/lextures/server-new/internal/auth"
)

func TestCommMessagesList_Unauthorized(t *testing.T) {
	t.Parallel()
	h := NewHandler(Deps{Pool: nil, JWTSigner: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/communication/messages?folder=inbox", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestCommWS_NoCommHub_DoesNot503(t *testing.T) {
	t.Parallel()
	s := auth.NewJWTSigner("test-jwt-here")
	h := NewHandler(Deps{JWTSigner: s, Comm: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/communication/ws", nil)
	h.ServeHTTP(rr, r)
	if rr.Code == http.StatusServiceUnavailable {
		t.Fatalf("comm ws: unexpected 503 when hub is nil (use read loop without pubsub): %d", rr.Code)
	}
}
