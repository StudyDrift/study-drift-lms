package httpserver

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/deviceua"
	"github.com/lextures/lextures/server/internal/repos/refreshtoken"
)

type sessionItemJSON struct {
	ID           string `json:"id"`
	CreatedAt    string `json:"createdAt"`
	LastUsedAt   string `json:"lastUsedAt"`
	DeviceLabel  string `json:"deviceLabel"`
	Location     string `json:"location"`
	AuthMethod   string `json:"authMethod"`
	IsCurrent    bool   `json:"isCurrent"`
}

type sessionsListJSON struct {
	Sessions []sessionItemJSON `json:"sessions"`
}

func formatAuthMethod(s *string) string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return "Unknown"
	}
	switch strings.ToLower(strings.TrimSpace(*s)) {
	case "password":
		return "Password"
	case "totp":
		return "TOTP (authenticator app)"
	case "backup_code":
		return "Backup code"
	case "webauthn":
		return "Passkey / WebAuthn"
	case "mfa_setup":
		return "MFA setup"
	case "magic_link":
		return "Magic link"
	case "oidc":
		return "OpenID Connect"
	case "saml":
		return "SAML SSO"
	case "clever":
		return "Clever"
	case "classlink":
		return "ClassLink"
	default:
		return strings.TrimSpace(*s)
	}
}

func formatLocation(city, country *string) string {
	c := derefTrim(city)
	co := derefTrim(country)
	if c != "" && co != "" {
		return c + ", " + co
	}
	if c != "" {
		return c
	}
	if co != "" {
		return co
	}
	return "Unknown"
}

func derefTrim(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

func (d Deps) handleListMySessions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().SessionManagementUIEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		au, err := auth.UserFromRequest(r, d.JWTSigner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		now := time.Now().UTC()
		rows, err := refreshtoken.ListActiveSessionsForUser(r.Context(), d.Pool, userID, now)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load sessions.")
			return
		}
		var currentID *uuid.UUID
		if au.RefreshTokenSessionID != nil {
			currentID = au.RefreshTokenSessionID
		}
		out := make([]sessionItemJSON, 0, len(rows))
		for _, row := range rows {
			ua := ""
			if row.UserAgent != nil {
				ua = *row.UserAgent
			}
			lastUsed := row.CreatedAt
			if row.LastRefreshedAt != nil {
				lastUsed = *row.LastRefreshedAt
			}
			isCur := currentID != nil && row.ID == *currentID
			out = append(out, sessionItemJSON{
				ID:          row.ID.String(),
				CreatedAt:   row.CreatedAt.UTC().Format(time.RFC3339),
				LastUsedAt:  lastUsed.UTC().Format(time.RFC3339),
				DeviceLabel: deviceua.Label(ua),
				Location:    formatLocation(row.LocationCity, row.LocationCountry),
				AuthMethod:  formatAuthMethod(row.AuthMethod),
				IsCurrent:   isCur,
			})
		}
		writeJSON(w, http.StatusOK, sessionsListJSON{Sessions: out})
	}
}

func (d Deps) handleDeleteMySession() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().SessionManagementUIEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		au, err := auth.UserFromRequest(r, d.JWTSigner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		rawID := chi.URLParam(r, "id")
		sid, err := uuid.Parse(strings.TrimSpace(rawID))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid session id.")
			return
		}
		if au.RefreshTokenSessionID != nil && sid == *au.RefreshTokenSessionID {
			apierr.WriteJSON(w, http.StatusUnprocessableEntity, apierr.CodeUnprocessableEntity, "Cannot revoke the current session from this UI.")
			return
		}
		now := time.Now().UTC()
		okRev, err := refreshtoken.RevokeByIDForUser(r.Context(), d.Pool, userID, sid, now)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not revoke session.")
			return
		}
		if !okRev {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Session not found.")
			return
		}
		slog.Info("session.revoked_by_user", "session_id", sid.String(), "user_id", userID.String())
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

func (d Deps) handleDeleteMyOtherSessions() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodDelete)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if !d.effectiveConfig().SessionManagementUIEnabled {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		au, err := auth.UserFromRequest(r, d.JWTSigner)
		if err != nil {
			apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
			return
		}
		now := time.Now().UTC()
		if err := refreshtoken.RevokeForUserExcept(r.Context(), d.Pool, userID, au.RefreshTokenSessionID, now); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not revoke sessions.")
			return
		}
		slog.Info("session.revoked_all_other_by_user", "user_id", userID.String())
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}
