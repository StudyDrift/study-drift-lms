package client_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lextures/lextures/clients/cli/internal/client"
)

func TestNewRequestInjectsAPIKey(t *testing.T) {
	c := client.New("https://example.com", "my-api-key")
	req, err := c.NewRequest(http.MethodGet, "/api/v1/courses", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	auth := req.Header.Get("Authorization")
	if auth != "Bearer my-api-key" {
		t.Errorf("Authorization = %q, want Bearer my-api-key", auth)
	}
}

func TestNewRequestNoAPIKey(t *testing.T) {
	c := client.New("https://example.com", "")
	req, err := c.NewRequest(http.MethodGet, "/api/v1/courses", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if auth := req.Header.Get("Authorization"); auth != "" {
		t.Errorf("expected no Authorization header, got %q", auth)
	}
}

func TestNewRequestBaseURLTrailingSlash(t *testing.T) {
	c := client.New("https://example.com/", "key")
	req, err := c.NewRequest(http.MethodGet, "/path", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if strings.Contains(req.URL.Path, "//") {
		t.Errorf("double slash in URL: %s", req.URL.String())
	}
}

func TestNewRequestSetsContentType(t *testing.T) {
	c := client.New("https://example.com", "")
	req, err := c.NewRequest(http.MethodPost, "/foo", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if ct := req.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
}

func TestDoExecutesRequest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("Authorization header missing or wrong: %q", r.Header.Get("Authorization"))
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := client.New(srv.URL, "test-key")
	req, _ := c.NewRequest(http.MethodGet, "/", nil)
	resp, err := c.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
}

func TestBaseURL(t *testing.T) {
	c := client.New("https://example.com/", "key")
	if c.BaseURL() != "https://example.com" {
		t.Errorf("BaseURL = %q, trailing slash should be stripped", c.BaseURL())
	}
}
