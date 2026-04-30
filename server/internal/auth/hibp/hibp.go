// Package hibp checks passwords against Have I Been Pwned using k-anonymity (5-hex prefix only).
package hibp

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/repos/passwordpolicy"
)

const pwnedBaseURL = "https://api.pwnedpasswords.com"
const userAgent = "Lextures/1.0 (password breach check; contact security@lextures)"

// Result is the outcome of a breach check.
type Result struct {
	BreachFound   bool
	HIBPAvailable bool
}

// Service performs HIBP range queries with optional DB-backed prefix cache.
type Service struct {
	HTTP *http.Client
	Pool *pgxpool.Pool
	// BaseURL overrides the Pwned Passwords API origin (tests). Empty uses production.
	BaseURL string
}

func (s *Service) baseURL() string {
	if s == nil {
		return pwnedBaseURL
	}
	if strings.TrimSpace(s.BaseURL) != "" {
		return strings.TrimRight(strings.TrimSpace(s.BaseURL), "/")
	}
	return pwnedBaseURL
}

// Check returns whether the password appears in the Pwned Passwords dataset.
// On network errors or timeout, returns Result{BreachFound: false, HIBPAvailable: false} (fail open).
func (s *Service) Check(ctx context.Context, password string) Result {
	if s == nil || s.HTTP == nil {
		slog.Warn("hibp: no HTTP client; skipping breach check (fail open)")
		return Result{BreachFound: false, HIBPAvailable: false}
	}
	sum := sha1.Sum([]byte(password))
	hexFull := strings.ToUpper(hex.EncodeToString(sum[:]))
	if len(hexFull) != 40 {
		return Result{BreachFound: false, HIBPAvailable: true}
	}
	prefix := hexFull[:5]
	suffix := hexFull[5:]

	if s.Pool != nil {
		if cached, ok, err := passwordpolicy.HIBPCacheGet(ctx, s.Pool, prefix); err != nil {
			slog.Warn("hibp: cache read failed", "err", err)
		} else if ok {
			found := parsePwnedBody(cached, suffix)
			return Result{BreachFound: found, HIBPAvailable: true}
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL()+"/range/"+prefix, nil)
	if err != nil {
		slog.Warn("hibp: request build failed", "err", err)
		return Result{BreachFound: false, HIBPAvailable: false}
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Add("Add-Padding", "true")

	resp, err := s.HTTP.Do(req)
	if err != nil {
		slog.Warn("hibp: request failed (fail open)", "err", err)
		return Result{BreachFound: false, HIBPAvailable: false}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil || resp.StatusCode != http.StatusOK {
		if err != nil {
			slog.Warn("hibp: read body failed (fail open)", "err", err)
		} else {
			slog.Warn("hibp: non-200 response (fail open)", "status", resp.StatusCode)
		}
		return Result{BreachFound: false, HIBPAvailable: false}
	}
	bodyStr := string(raw)
	if s.Pool != nil {
		if err := passwordpolicy.HIBPCachePut(ctx, s.Pool, prefix, bodyStr); err != nil {
			slog.Warn("hibp: cache write failed", "err", err)
		}
	}
	found := parsePwnedBody(bodyStr, suffix)
	return Result{BreachFound: found, HIBPAvailable: true}
}

func parsePwnedBody(body, suffixUpper string) bool {
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) != 2 {
			continue
		}
		hashSuffix := strings.TrimSpace(strings.ToUpper(parts[0]))
		if hashSuffix == suffixUpper {
			return true
		}
	}
	return false
}

// DefaultHTTPClient returns an HTTP client with a 500ms timeout per plan NFR.
func DefaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 500 * time.Millisecond}
}

// NewService builds a production checker using the shared DB pool (may be nil for cache-less).
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{HTTP: DefaultHTTPClient(), Pool: pool}
}

// StubChecker is used in tests to avoid network.
type StubChecker struct {
	Result Result
}

// Check implements the checker interface used by authservice.
func (s StubChecker) Check(context.Context, string) Result {
	return s.Result
}

// Checker is satisfied by *Service and StubChecker.
type Checker interface {
	Check(ctx context.Context, password string) Result
}

// AsChecker adapts *Service to Checker (nil-safe: fail open).
func AsChecker(s *Service) Checker {
	if s == nil {
		return StubChecker{Result: Result{BreachFound: false, HIBPAvailable: false}}
	}
	return s
}

// RequestURLForTests returns the URL that would be requested (prefix only in path). For unit tests.
// RequestURLForPassword returns the full URL used for k-anonymity (path contains 5-hex prefix only).
func RequestURLForPassword(password string) string {
	sum := sha1.Sum([]byte(password))
	hexFull := strings.ToUpper(hex.EncodeToString(sum[:]))
	return fmt.Sprintf("%s/range/%s", pwnedBaseURL, hexFull[:5])
}
