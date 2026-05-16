package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/service/authservice"
)

func (d Deps) handleCLIAuthRequest() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "Database is not configured.")
			return
		}
		token, err := authservice.RequestCLIAuth(r.Context(), d.Pool)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not create CLI auth session.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"token":      token,
			"expires_in": 600,
		})
	}
}

func (d Deps) handleCLIAuthPoll() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		token := strings.TrimSpace(r.URL.Query().Get("token"))
		if token == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "token query parameter is required.")
			return
		}
		if d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "Database is not configured.")
			return
		}
		result, err := authservice.PollCLIAuth(r.Context(), d.Pool, token)
		if err != nil {
			if errors.Is(err, authservice.ErrCLISessionNotFound) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "CLI auth session not found or expired.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not poll CLI auth session.")
			return
		}
		if !result.Approved {
			writeJSON(w, http.StatusOK, map[string]any{"status": "pending"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "approved",
			"access_token":  result.AccessToken,
			"refresh_token": result.RefreshToken,
			"expires_in":    result.ExpiresIn,
		})
	}
}

func (d Deps) handleCLIAuthApprove() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		var body struct {
			Token string `json:"token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		token := strings.TrimSpace(body.Token)
		if token == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "token is required.")
			return
		}
		err := authservice.ApproveCLIAuth(r.Context(), d.Pool, d.JWTSigner, token, userID, authservice.ClientMetaFromRequest(r))
		if err != nil {
			if errors.Is(err, authservice.ErrCLISessionNotFound) {
				apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "CLI auth session not found or expired.")
				return
			}
			if errors.Is(err, authservice.ErrCLISessionAlreadyApproved) {
				apierr.WriteJSON(w, http.StatusConflict, apierr.CodeInvalidInput, "CLI auth session already approved.")
				return
			}
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not approve CLI auth session.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
