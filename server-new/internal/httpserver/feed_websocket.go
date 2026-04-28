package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server-new/internal/repos/enrollment"
)

// handleFeedWS is GET /api/v1/courses/{course_code}/feed/ws — first text: {"authToken":"…"}.
// Full feed broadcast is not ported yet; the connection stays open so the SPA does not log handshake failures.
func (d Deps) handleFeedWS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.JWTSigner == nil || d.Pool == nil {
			http.Error(w, "server misconfiguration", http.StatusServiceUnavailable)
			return
		}
		courseCode := chi.URLParam(r, "course_code")
		if courseCode == "" {
			http.Error(w, "missing course", http.StatusBadRequest)
			return
		}
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: []string{"*"},
		})
		if err != nil {
			return
		}
		defer func() { _ = c.Close(websocket.StatusNormalClosure, "") }()

		readAuthCtx, cancelAuth := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancelAuth()
		typ, b, err := c.Read(readAuthCtx)
		if err != nil {
			return
		}
		if typ != websocket.MessageText {
			return
		}
		var m struct {
			AuthToken string `json:"authToken"`
		}
		if err := json.Unmarshal(b, &m); err != nil || m.AuthToken == "" {
			return
		}
		u, err := d.JWTSigner.Verify(m.AuthToken)
		if err != nil {
			return
		}
		uid, err := uuid.Parse(u.UserID)
		if err != nil {
			return
		}
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, uid)
		if err != nil || !has {
			return
		}
		runCtx, stop := context.WithCancel(r.Context())
		defer stop()
		for {
			_, _, err := c.Read(runCtx)
			if err != nil {
				return
			}
		}
	}
}
