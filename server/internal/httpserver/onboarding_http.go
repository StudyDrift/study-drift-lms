package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/onboardingevent"
)

// ---------------------------------------------------------------------------
// IP-based fixed-window rate limiter (onboarding endpoint only)
// ---------------------------------------------------------------------------

const (
	onboardingRateLimit  = 5                // max events per IP per window
	onboardingRateWindow = 10 * time.Minute // window duration
	onboardingCleanEvery = time.Hour        // how often to evict stale entries
)

type onboardingIPEntry struct {
	count int
	reset time.Time
}

var (
	onboardingMu        sync.Mutex
	onboardingLimiters  = map[string]*onboardingIPEntry{}
	onboardingLastClean = time.Now()
)

// onboardingCheckRate returns true if the request is within rate limits.
// A single mutex guards the map for simplicity; the endpoint is low-traffic.
func onboardingCheckRate(ip string) bool {
	onboardingMu.Lock()
	defer onboardingMu.Unlock()

	now := time.Now()

	// Lazy cleanup: evict expired entries once per hour.
	if now.Sub(onboardingLastClean) > onboardingCleanEvery {
		for k, v := range onboardingLimiters {
			if now.After(v.reset) {
				delete(onboardingLimiters, k)
			}
		}
		onboardingLastClean = now
	}

	e, ok := onboardingLimiters[ip]
	if !ok {
		onboardingLimiters[ip] = &onboardingIPEntry{count: 1, reset: now.Add(onboardingRateWindow)}
		return true
	}
	if now.After(e.reset) {
		e.count = 1
		e.reset = now.Add(onboardingRateWindow)
		return true
	}
	e.count++
	return e.count <= onboardingRateLimit
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type onboardingTrackRequest struct {
	Program      string `json:"program"`
	SchoolName   string `json:"school_name"`
	Language     string `json:"language"`
	Timezone     string `json:"timezone"`
	ScreenWidth  int32  `json:"screen_width"`
	ScreenHeight int32  `json:"screen_height"`
	Referrer     string `json:"referrer"`
}

func (d Deps) handlePublicOnboardingTrack() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := onboardingRealIP(r)
		if !onboardingCheckRate(ip) {
			w.Header().Set("Retry-After", "600")
			apierr.WriteJSON(w, http.StatusTooManyRequests, apierr.CodeRateLimited, "Too many requests. Please try again later.")
			return
		}

		var req onboardingTrackRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid request body")
			return
		}

		switch req.Program {
		case "k-12", "higher-ed", "self-learner":
		default:
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid program value")
			return
		}

		evt := onboardingevent.Event{
			Program:   req.Program,
			IPAddress: onboardingStrPtr(ip),
			UserAgent: onboardingStrPtr(r.Header.Get("User-Agent")),
			Country:   onboardingGeoCountry(r),
		}
		if s := onboardingTrim(req.SchoolName, 200); s != "" {
			evt.SchoolName = &s
		}
		if s := onboardingTrim(req.Referrer, 500); s != "" {
			evt.Referrer = &s
		}
		if s := onboardingTrim(req.Language, 20); s != "" {
			evt.Language = &s
		}
		if s := onboardingTrim(req.Timezone, 60); s != "" {
			evt.Timezone = &s
		}
		if req.ScreenWidth > 0 {
			evt.ScreenWidth = &req.ScreenWidth
		}
		if req.ScreenHeight > 0 {
			evt.ScreenHeight = &req.ScreenHeight
		}

		// Silently swallow DB errors: clients must not be able to infer
		// internal state from this unauthenticated endpoint.
		_ = onboardingevent.Insert(r.Context(), d.Pool, evt)
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func onboardingRealIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return strings.TrimSpace(ip)
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.TrimSpace(strings.SplitN(fwd, ",", 2)[0])
	}
	addr := r.RemoteAddr
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		addr = addr[:i]
	}
	return addr
}

// onboardingGeoCountry reads common GeoIP headers set by CDN/reverse-proxy layers.
func onboardingGeoCountry(r *http.Request) *string {
	for _, h := range []string{"CF-IPCountry", "X-Country-Code", "X-Geoip-Country"} {
		if v := r.Header.Get(h); v != "" && v != "XX" {
			return onboardingStrPtr(v)
		}
	}
	return nil
}

func onboardingTrim(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) > max {
		return s[:max]
	}
	return s
}

func onboardingStrPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
