package hibp

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRequestURLForPassword_OnlyFiveHexPrefixInPath(t *testing.T) {
	t.Parallel()
	u := RequestURLForPassword("correct horse battery staple")
	if !strings.Contains(u, "/range/") {
		t.Fatalf("missing range path: %q", u)
	}
	sum := sha1.Sum([]byte("correct horse battery staple"))
	wantPrefix := strings.ToUpper(hex.EncodeToString(sum[:]))[:5]
	if !strings.HasSuffix(u, "/range/"+wantPrefix) {
		t.Fatalf("path suffix want /range/%s got %q", wantPrefix, u)
	}
	if strings.Count(u, "/") < 3 {
		t.Fatal("unexpected URL shape")
	}
}

func TestCheck_OutboundRequestPathFiveChars(t *testing.T) {
	t.Parallel()
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("\n"))
	}))
	defer srv.Close()

	s := &Service{
		HTTP:    srv.Client(),
		Pool:    nil,
		BaseURL: srv.URL,
	}
	res := s.Check(context.Background(), "x")
	if !res.HIBPAvailable {
		t.Fatalf("expected HIBP available, got %+v", res)
	}
	if !strings.HasPrefix(gotPath, "/range/") || len(gotPath) != len("/range/")+5 {
		t.Fatalf("want /range/ plus 5 hex chars, got %q (len %d)", gotPath, len(gotPath))
	}
	for _, c := range gotPath[len("/range/"):] {
		if c >= '0' && c <= '9' || c >= 'A' && c <= 'F' {
			continue
		}
		t.Fatalf("non-hex in prefix path: %q", gotPath)
	}
}

func TestCheck_BreachHit(t *testing.T) {
	t.Parallel()
	sum := sha1.Sum([]byte("unit-test-password"))
	hexFull := strings.ToUpper(hex.EncodeToString(sum[:]))
	prefix := hexFull[:5]
	suffix := hexFull[5:]
	body := suffix + ":99\r\n"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/range/"+prefix {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	s := &Service{HTTP: srv.Client(), Pool: nil, BaseURL: srv.URL}
	res := s.Check(context.Background(), "unit-test-password")
	if !res.HIBPAvailable || !res.BreachFound {
		t.Fatalf("want breach hit, got %+v", res)
	}
}

func TestCheck_FailOpenOnNon200(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	s := &Service{HTTP: srv.Client(), Pool: nil, BaseURL: srv.URL}
	res := s.Check(context.Background(), "anything")
	if res.HIBPAvailable || res.BreachFound {
		t.Fatalf("want fail-open unavailable, got %+v", res)
	}
}
