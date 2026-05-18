package httpserver

import (
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/auth"
	"github.com/lextures/lextures/server/internal/repos/organization"
)

// meUserIDOrQueryToken is like meUserID but also accepts ?token= for SSE clients.
func (d Deps) meUserIDOrQueryToken(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	// Inject query token into header if no Authorization header present.
	if qt := r.URL.Query().Get("token"); qt != "" && r.Header.Get("Authorization") == "" {
		r.Header.Set("Authorization", "Bearer "+qt)
	}
	if d.JWTSigner == nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	u, err := auth.UserFromRequest(r, d.JWTSigner)
	if err != nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	userID, err := uuid.Parse(u.UserID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusUnauthorized, apierr.CodeUnauthorized, "Sign in required.")
		return uuid.UUID{}, false
	}
	if d.Pool == nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
		return uuid.UUID{}, false
	}
	dbOrgID, err := organization.OrgIDForUser(r.Context(), d.Pool, userID)
	if err != nil {
		apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Server misconfiguration.")
		return uuid.UUID{}, false
	}
	if u.OrgID != "" && u.OrgID != dbOrgID.String() {
		apierr.WriteJSON(w, http.StatusForbidden, apierr.CodeForbidden, "You do not have permission for this action.")
		return uuid.UUID{}, false
	}
	return userID, true
}

// handleNotificationsSSE streams Server-Sent Events to the client for real-time bell count updates.
// Accepts auth via Authorization: Bearer <token> header OR ?token=<token> query parameter
// (EventSource browsers cannot set custom headers).
func (d Deps) handleNotificationsSSE() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Try header first; fall back to query param for EventSource clients.
		userID, ok := d.meUserIDOrQueryToken(w, r)
		if !ok {
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "SSE not supported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		flusher.Flush()

		if d.NotifHub == nil {
			// Hub not configured — send a keepalive and close.
			_, _ = fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
			return
		}

		ch, unsub := d.NotifHub.Subscribe(userID)
		defer unsub()

		keepalive := time.NewTicker(25 * time.Second)
		defer keepalive.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-keepalive.C:
				_, _ = fmt.Fprint(w, ": keepalive\n\n")
				flusher.Flush()
			case <-ch:
				_, _ = fmt.Fprint(w, "event: notification\ndata: {}\n\n")
				flusher.Flush()
			}
		}
	}
}
