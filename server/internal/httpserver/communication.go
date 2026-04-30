package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	commodels "github.com/lextures/lextures/server/internal/models/communication"
	"github.com/lextures/lextures/server/internal/repos/communication"
	"github.com/lextures/lextures/server/internal/repos/user"
)

const mailboxUpdateJSON = `{"type":"mailbox_updated"}`

func validateListFolder(f string) bool {
	switch f {
	case "inbox", "starred", "sent", "drafts", "trash":
		return true
	default:
		return false
	}
}

func validatePatchFolder(f string) bool {
	switch f {
	case "inbox", "sent", "drafts", "trash":
		return true
	default:
		return false
	}
}

func (d Deps) notifyMailbox(userID uuid.UUID) {
	if d.Comm == nil {
		return
	}
	d.Comm.Broadcast(userID, mailboxUpdateJSON)
}

// handleCommMessagesList is GET /api/v1/communication/messages?folder&...
func (d Deps) handleCommMessagesList() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		folder := r.URL.Query().Get("folder")
		if folder == "" || !validateListFolder(folder) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid folder.")
			return
		}
		q := r.URL.Query().Get("q")
		msgs, err := communication.ListForUser(r.Context(), d.Pool, userID, folder, q)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not list messages.")
			return
		}
		if msgs == nil {
			msgs = []commodels.MailboxMessage{}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(commodels.MailboxListResponse{Messages: msgs})
	}
}

// handleCommMessagesPost is POST /api/v1/communication/messages
func (d Deps) handleCommMessagesPost() http.HandlerFunc {
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
		var req struct {
			ToEmailSnake *string `json:"to_email"`
			ToEmailCamel *string `json:"toEmail"`
			Subject      string  `json:"subject"`
			Body         string  `json:"body"`
			Draft        bool    `json:"draft"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		req.Subject = strings.TrimSpace(req.Subject)
		req.Body = strings.TrimSpace(req.Body)
		if req.Draft {
			id, err := communication.SaveDraft(r.Context(), d.Pool, userID, req.Subject, req.Body)
			if err != nil {
				apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not save draft.")
				return
			}
			d.notifyMailbox(userID)
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_ = json.NewEncoder(w).Encode(commodels.SendMessageResponse{ID: id})
			return
		}
		to := ""
		if req.ToEmailSnake != nil {
			to = strings.TrimSpace(*req.ToEmailSnake)
		} else if req.ToEmailCamel != nil {
			to = strings.TrimSpace(*req.ToEmailCamel)
		}
		if to == "" {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "to_email is required to send.")
			return
		}
		id, err := communication.SendMessage(r.Context(), d.Pool, userID, to, req.Subject, req.Body)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not send message.")
			return
		}
		if id == nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "No user registered with that email.")
			return
		}
		d.notifyMailbox(userID)
		if u, e := user.FindByEmail(r.Context(), d.Pool, user.NormalizeEmail(to)); e == nil && u != nil {
			if rid, e2 := uuid.Parse(u.ID); e2 == nil && rid != userID {
				d.notifyMailbox(rid)
			}
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(commodels.SendMessageResponse{ID: *id})
	}
}

// handleCommMessageGet is GET /api/v1/communication/messages/{id}
func (d Deps) handleCommMessageGet() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid message id.")
			return
		}
		msg, err := communication.GetForUser(r.Context(), d.Pool, userID, id)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not load message.")
			return
		}
		if msg == nil {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(msg)
	}
}

// handleCommMessagePatch is PATCH /api/v1/communication/messages/{id}
func (d Deps) handleCommMessagePatch() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodPatch)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		mid, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid message id.")
			return
		}
		var req commodels.PatchMailboxRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid JSON body.")
			return
		}
		if req.Folder != nil && !validatePatchFolder(*req.Folder) {
			apierr.WriteJSON(w, http.StatusBadRequest, apierr.CodeInvalidInput, "Invalid folder.")
			return
		}
		ok2, err := communication.UpdateMailbox(r.Context(), d.Pool, userID, mid, &req)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not update message.")
			return
		}
		if !ok2 {
			apierr.WriteJSON(w, http.StatusNotFound, apierr.CodeNotFound, "Not found.")
			return
		}
		d.notifyMailbox(userID)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

// handleCommUnread is GET /api/v1/communication/unread-count
func (d Deps) handleCommUnread() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		userID, ok := d.meUserID(w, r)
		if !ok {
			return
		}
		n, err := communication.CountUnreadInbox(r.Context(), d.Pool, userID)
		if err != nil {
			apierr.WriteJSON(w, http.StatusInternalServerError, apierr.CodeInternal, "Could not count unread.")
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(commodels.UnreadCountResponse{UnreadInbox: n})
	}
}

// handleCommWS is GET /api/v1/communication/ws — first text message: {"authToken":"…"} (serde camelCase).
func (d Deps) handleCommWS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.JWTSigner == nil {
			http.Error(w, "auth not configured", http.StatusServiceUnavailable)
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

		runCtx, stop := context.WithCancel(r.Context())
		defer stop()

		if d.Comm != nil {
			recv, unsub := d.Comm.Subscribe()
			defer unsub()
			go func() {
				for {
					select {
					case ev, ok := <-recv:
						if !ok {
							return
						}
						if ev.UserID == uid {
							_ = c.Write(runCtx, websocket.MessageText, []byte(ev.JSON)) //nolint:errcheck
						}
					case <-runCtx.Done():
						return
					}
				}
			}()
		}

		for {
			_, _, err := c.Read(runCtx)
			if err != nil {
				return
			}
		}
	}
}
