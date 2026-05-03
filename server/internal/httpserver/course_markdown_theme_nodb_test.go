package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/config"
)

// Regression: PATCH must be registered on the same Route as GET /courses/{code} (chi loses the
// leaf GET if you add r.Route with only Patch after r.Get on the same path — see server.go).
func TestPatchMarkdownTheme_Not404NoRoute(t *testing.T) {
	signer := auth.NewJWTSigner("01234567890123456789012345678901")
	h := NewHandler(Deps{Pool: nil, JWTSigner: signer, Config: config.Config{}})
	rr := httptest.NewRecorder()
	body := `{"preset":"night"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/courses/C-TEST/markdown-theme", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	// any bearer so meUserID runs; db nil will 500 on access check, not 404
	tok, _ := signer.Sign(context.Background(), "00000000-0000-0000-0000-000000000001", "u@test.com", "", "", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rr, req)
	if rr.Code == http.StatusNotFound {
		t.Fatalf("expected handler to be registered, got 404: %s", rr.Body.String())
	}
}
