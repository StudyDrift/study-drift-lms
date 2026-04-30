package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
)

// Regression: PUT /api/v1/courses/{code} must be registered (not 405 Method Not Allowed).
func TestPutCourse_Not405NoRoute(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: signer, Config: config.Config{}})
	rr := httptest.NewRecorder()
	body := `{"title":"T","description":"","published":true,"scheduleMode":"fixed",` +
		`"startsAt":null,"endsAt":null,"visibleFrom":null,"hiddenAt":null,` +
		`"relativeEndAfter":null,"relativeHiddenAfter":null}`
	req := httptest.NewRequest(http.MethodPut, "/api/v1/courses/C-TEST", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	tok, _ := signer.Sign("00000000-0000-0000-0000-000000000001", "u@test.com")
	req.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, req)
	if rr.Code == http.StatusMethodNotAllowed {
		t.Fatalf("expected PUT to be registered, got 405: %s", rr.Body.String())
	}
}
