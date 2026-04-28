package openrouter

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatCompletion_OK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"## Hi\n- one"}}]}`))
	}))
	defer srv.Close()
	c := NewClientWithBaseURL("test-key", srv.URL+"/v1")
	got, err := c.ChatCompletion("m", []Message{{Role: "user", Content: "x"}})
	if err != nil {
		t.Fatal(err)
	}
	if got != "## Hi\n- one" {
		t.Fatalf("content: %q", got)
	}
}

func TestChatCompletion_Non2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`err`))
	}))
	defer srv.Close()
	c := NewClientWithBaseURL("k", srv.URL+"/v1")
	_, err := c.ChatCompletion("m", nil)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNewClient_UsesDefaultBase(t *testing.T) {
	c := NewClient("abc")
	if c.baseURL != DefaultBaseURL {
		t.Fatalf("base: %q", c.baseURL)
	}
}
