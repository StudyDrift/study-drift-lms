package httpserver

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lextures/lextures/server/internal/apierr"
)

func TestNotFound_UnknownPath_JSONAndCode(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	// Concrete /api/v1/settings/ai is implemented; use a still-unregistered path.
	r := httptest.NewRequest(http.MethodGet, "/api/v1/settings/ai/zzz-not-mounted", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("code: %d", rr.Code)
	}
	var b struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&b); err != nil {
		t.Fatalf("json: %v", err)
	}
	if b.Error.Code != apierr.CodeNotFound {
		t.Fatalf("code: %q", b.Error.Code)
	}
	if !strings.Contains(b.Error.Message, "No HTTP route") {
		t.Fatalf("message: %q", b.Error.Message)
	}
}
