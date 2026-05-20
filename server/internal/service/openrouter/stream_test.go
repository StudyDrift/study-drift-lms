package openrouter

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatCompletionStream_OK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		chunks := []string{"Hello", " ", "world"}
		for _, ch := range chunks {
			_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n\n", ch)
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	c := NewClientWithBaseURL("test-key", srv.URL+"/v1")
	var got []string
	full, err := c.ChatCompletionStream("m", []Message{{Role: "user", Content: "hi"}}, func(text string) error {
		got = append(got, text)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if full != "Hello world" {
		t.Errorf("full text: %q", full)
	}
	if len(got) != 3 {
		t.Errorf("chunk count: %d", len(got))
	}
}

func TestChatCompletionStream_Non2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte("bad request"))
	}))
	defer srv.Close()

	c := NewClientWithBaseURL("k", srv.URL+"/v1")
	_, err := c.ChatCompletionStream("m", nil, nil)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestChatCompletionStream_NilClient(t *testing.T) {
	var c *Client
	_, err := c.ChatCompletionStream("m", nil, nil)
	if err == nil {
		t.Fatal("expected error for nil client")
	}
}

func TestChatCompletionStream_MissingKey(t *testing.T) {
	c := &Client{}
	_, err := c.ChatCompletionStream("m", nil, nil)
	if err == nil {
		t.Fatal("expected error for missing api key")
	}
}

func TestChatCompletionStream_IgnoresNonDataLines(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = fmt.Fprint(w, ": keepalive\n\n")
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n")
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	c := NewClientWithBaseURL("k", srv.URL+"/v1")
	full, err := c.ChatCompletionStream("m", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if full != "ok" {
		t.Errorf("full: %q", full)
	}
}
