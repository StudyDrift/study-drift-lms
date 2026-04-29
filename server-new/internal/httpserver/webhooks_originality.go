package httpserver

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/lextures/lextures/server-new/internal/apierr"
	"github.com/lextures/lextures/server-new/internal/repos/originalityconfig"
	"github.com/lextures/lextures/server-new/internal/repos/originalityreports"
)

type webhookOriginalityBody struct {
	ProviderReportID string   `json:"providerReportId"`
	SimilarityPct    *float64 `json:"similarityPct"`
	ReportURL        *string  `json:"reportUrl"`
	ReportToken      *string  `json:"reportToken"`
}

// handleOriginalityWebhook is POST /api/v1/webhooks/originality/{provider} (provider callback; HMAC-signed).
func (d Deps) handleOriginalityWebhook() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().OriginalityDetectionEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "Database unavailable.")
			return
		}
		provider := strings.TrimSpace(chi.URLParam(r, "provider"))
		if provider == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Missing provider in path.")
			return
		}
		cfg, err := originalityconfig.GetSingleton(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to load originality config.")
			return
		}
		if cfg == nil || cfg.WebhookHMACSecret == nil || strings.TrimSpace(*cfg.WebhookHMACSecret) == "" {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid body.")
			return
		}
		secret := strings.TrimSpace(*cfg.WebhookHMACSecret)
		expected := computeOriginalityHMACHex([]byte(secret), body)
		sig := r.Header.Get("X-Originality-Signature")
		if sig == "" {
			sig = r.Header.Get("x-originality-signature")
		}
		if !constantTimeSigEqual(sig, expected) {
			apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "Forbidden.")
			return
		}
		var parsed webhookOriginalityBody
		if err := json.Unmarshal(body, &parsed); err != nil || strings.TrimSpace(parsed.ProviderReportID) == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid webhook JSON (expected providerReportId).")
			return
		}
		updated, err := originalityreports.MarkDoneByProviderReport(
			r.Context(), d.Pool,
			provider,
			strings.TrimSpace(parsed.ProviderReportID),
			parsed.SimilarityPct,
			parsed.ReportURL,
			parsed.ReportToken,
		)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Failed to update report.")
			return
		}
		if len(updated) == 0 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		// Optional: persist full webhook JSON + text snapshot to course files (Rust storage::best_effort_store_from_parts); not ported here.
		w.WriteHeader(http.StatusNoContent)
	}
}

func computeOriginalityHMACHex(secret, body []byte) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func constantTimeSigEqual(header, expected string) bool {
	h := strings.ToLower(strings.TrimSpace(header))
	e := strings.ToLower(strings.TrimSpace(expected))
	if len(h) != len(e) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(h), []byte(e)) == 1
}
