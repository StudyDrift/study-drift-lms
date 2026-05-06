package hibp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBaseURL_NilAndOverrides(t *testing.T) {
	var s *Service
	if got := s.baseURL(); got != pwnedBaseURL {
		t.Fatalf("nil-receiver default: %q", got)
	}
	s2 := &Service{BaseURL: ""}
	if got := s2.baseURL(); got != pwnedBaseURL {
		t.Fatalf("empty default: %q", got)
	}
	s3 := &Service{BaseURL: "  https://x.test/  "}
	if got := s3.baseURL(); got != "https://x.test" {
		t.Fatalf("trim+rstrip: %q", got)
	}
}

func TestCheck_NilHTTPFailOpen(t *testing.T) {
	s := &Service{}
	r := s.Check(context.Background(), "x")
	if r.HIBPAvailable || r.BreachFound {
		t.Fatalf("expected fail open: %+v", r)
	}
}

func TestCheck_TransportError(t *testing.T) {
	s := &Service{HTTP: http.DefaultClient, BaseURL: "http://127.0.0.1:1"}
	r := s.Check(context.Background(), "x")
	if r.HIBPAvailable {
		t.Fatalf("expected fail open: %+v", r)
	}
}

func TestCheck_ServerSlow_Truncated(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ABCDE:1\nzzzzz\n   \n"))
	}))
	defer srv.Close()
	s := &Service{HTTP: srv.Client(), BaseURL: srv.URL}
	r := s.Check(context.Background(), "anything")
	if !r.HIBPAvailable {
		t.Fatal("should be available")
	}
}

func TestParsePwnedBody(t *testing.T) {
	body := "AAAA1:5\nBBBB2:11\n\nbadlinewithoutcolon\n"
	if !parsePwnedBody(body, "AAAA1") {
		t.Fatal("hit AAAA1")
	}
	if parsePwnedBody(body, "ZZZZZ") {
		t.Fatal("no hit")
	}
	if parsePwnedBody("", "X") {
		t.Fatal("empty")
	}
}

func TestDefaultHTTPClient(t *testing.T) {
	c := DefaultHTTPClient()
	if c.Timeout == 0 {
		t.Fatal("expected timeout")
	}
}

func TestNewService(t *testing.T) {
	s := NewService(nil)
	if s == nil || s.HTTP == nil {
		t.Fatal("expected service")
	}
}

func TestStubChecker(t *testing.T) {
	s := StubChecker{Result: Result{BreachFound: true, HIBPAvailable: true}}
	if !s.Check(context.Background(), "x").BreachFound {
		t.Fatal("stub")
	}
}

func TestAsChecker(t *testing.T) {
	c := AsChecker(nil)
	if c == nil {
		t.Fatal("nil-safe")
	}
	if c.Check(context.Background(), "x").HIBPAvailable {
		t.Fatal("nil -> fail open")
	}
	c2 := AsChecker(&Service{})
	if c2 == nil {
		t.Fatal("non-nil")
	}
}
