package httpserver

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/notificationprefs"
	"github.com/lextures/lextures/server/internal/service/notifications"
)

func (d Deps) handleGetMyNotificationPreferences() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		rows, err := notificationprefs.ListForUser(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load notification preferences.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"preferences": rows})
	}
}

func (d Deps) handlePutMyNotificationPreferences() http.HandlerFunc {
	type item struct {
		EventType    string  `json:"eventType"`
		EmailEnabled *bool   `json:"emailEnabled"`
		PushEnabled  *bool   `json:"pushEnabled"`
		DigestMode   *string `json:"digestMode"`
	}
	type body struct {
		Preferences []item `json:"preferences"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		payload, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not read body.")
			return
		}
		var b body
		if err := json.Unmarshal(payload, &b); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		for _, p := range b.Preferences {
			if p.EventType == "" {
				continue
			}
			if p.DigestMode != nil {
				mode := *p.DigestMode
				if mode != "instant" && mode != "daily" && mode != "off" {
					apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "digestMode must be instant, daily, or off.")
					return
				}
			}
			if err := notificationprefs.UpsertItem(r.Context(), d.Pool, userID, p.EventType, p.EmailEnabled, p.PushEnabled, p.DigestMode); err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not save preferences.")
				return
			}
		}
		rows, err := notificationprefs.ListForUser(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load notification preferences.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"preferences": rows})
	}
}

func (d Deps) handleUnsubscribe() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "Missing token.", http.StatusBadRequest)
			return
		}
		cfg := d.effectiveConfig()
		userID, eventType, err := notifications.ParseUnsubscribeToken(cfg.JWTSecret, token)
		if err != nil {
			http.Error(w, "Invalid or expired link.", http.StatusBadRequest)
			return
		}
		if err := notificationprefs.SetEmailEnabled(r.Context(), d.Pool, userID, eventType, false); err != nil {
			http.Error(w, "Could not update preferences.", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;">
<h1>Unsubscribed</h1>
<p>You will no longer receive email for this notification type. You can re-enable it in Settings → Notifications.</p>
</body></html>`))
	}
}
