package openapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServeOpenAPI(t *testing.T) {
	rr := httptest.NewRecorder()
	ServeOpenAPI(rr, httptest.NewRequest(http.MethodGet, "/api/openapi.json", nil))
	if rr.Code != 200 {
		t.Fatalf("code: %d", rr.Code)
	}
	if g := strings.TrimSpace(rr.Header().Get("Content-Type")); !strings.HasPrefix(g, "application/json") {
		t.Fatalf("content-type: %q", g)
	}
	var doc map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	if doc["openapi"] != "3.0.3" {
		t.Fatalf("openapi version: %v", doc["openapi"])
	}
	info, _ := doc["info"].(map[string]any)
	if info == nil || info["title"] != "StudyDrift API" {
		t.Fatalf("info: %#v", doc["info"])
	}
}

func TestServeOpenAPI_MethodNotAllowed(t *testing.T) {
	rr := httptest.NewRecorder()
	ServeOpenAPI(rr, httptest.NewRequest(http.MethodPost, "/api/openapi.json", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("code: %d", rr.Code)
	}
}

func TestServeDocs(t *testing.T) {
	rr := httptest.NewRecorder()
	ServeDocs(rr, httptest.NewRequest(http.MethodGet, "/api/docs", nil))
	if rr.Code != 200 {
		t.Fatalf("code: %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "swagger-ui") && !strings.Contains(body, "Swagger") {
		t.Fatalf("expected swagger in html")
	}
	if !strings.Contains(body, "/api/openapi.json") {
		t.Fatalf("expected spec url in html")
	}
}

func TestServeDocs_MethodNotAllowed(t *testing.T) {
	rr := httptest.NewRecorder()
	ServeDocs(rr, httptest.NewRequest(http.MethodPut, "/api/docs", nil))
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("code: %d", rr.Code)
	}
}
