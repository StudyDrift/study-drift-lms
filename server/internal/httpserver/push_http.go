package httpserver

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/notificationsinbox"
	"github.com/lextures/lextures/server/internal/repos/pushsubscriptions"
)

// handleGetVAPIDPublicKey returns the VAPID public key for service worker registration (public endpoint).
func (d Deps) handleGetVAPIDPublicKey() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg := d.effectiveConfig()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]string{"publicKey": cfg.VAPIDPublicKey})
	}
}

// handlePostMyPushSubscription registers a push subscription for the authenticated user.
func (d Deps) handlePostMyPushSubscription() http.HandlerFunc {
	type keysBody struct {
		P256DH string `json:"p256dh"`
		Auth   string `json:"auth"`
	}
	type body struct {
		Endpoint  string   `json:"endpoint"`
		Keys      keysBody `json:"keys"`
		UserAgent string   `json:"userAgent"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		payload, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Could not read body.")
			return
		}
		var b body
		if err := json.Unmarshal(payload, &b); err != nil || b.Endpoint == "" || b.Keys.P256DH == "" || b.Keys.Auth == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "endpoint, keys.p256dh, and keys.auth are required.")
			return
		}
		id, err := pushsubscriptions.Insert(r.Context(), d.Pool, userID, b.Endpoint, b.Keys.P256DH, b.Keys.Auth, b.UserAgent)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not save subscription.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{"id": id.String()})
	}
}

// handleDeleteMyPushSubscription removes a push subscription.
func (d Deps) handleDeleteMyPushSubscription() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		idStr := chi.URLParam(r, "id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid subscription id.")
			return
		}
		if err := pushsubscriptions.Delete(r.Context(), d.Pool, id, userID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not delete subscription.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleGetMyNotifications returns paginated in-app notifications.
func (d Deps) handleGetMyNotifications() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		rows, err := notificationsinbox.List(r.Context(), d.Pool, userID, 25, 0)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load notifications.")
			return
		}
		unread, _ := notificationsinbox.UnreadCount(r.Context(), d.Pool, userID)
		if rows == nil {
			rows = []notificationsinbox.Row{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"notifications": rows,
			"unreadCount":   unread,
		})
	}
}

// handleMarkNotificationRead marks one notification as read.
func (d Deps) handleMarkNotificationRead() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		idStr := chi.URLParam(r, "id")
		id, err := uuid.Parse(idStr)
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid notification id.")
			return
		}
		if err := notificationsinbox.MarkRead(r.Context(), d.Pool, id, userID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not mark as read.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleMarkAllNotificationsRead marks all notifications as read for the user.
func (d Deps) handleMarkAllNotificationsRead() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		if err := notificationsinbox.MarkAllRead(r.Context(), d.Pool, userID); err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not mark all as read.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
