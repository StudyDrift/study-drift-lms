package httpserver

// Y.js WebSocket relay for collaborative documents (plan 6.5).
//
// Protocol: minimal y-websocket sync protocol.
//   Binary messages starting with byte 0 = Y.js sync → relay + persist
//   Binary messages starting with byte 1 = Y.js awareness → relay only
//
// Each new client receives all stored sync updates so it can reconstruct
// the current document state. Y.js CRDTs handle duplicates idempotently.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/lextures/lextures/server/internal/apierr"
	"github.com/lextures/lextures/server/internal/repos/collabdocs"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/enrollment"
)

// collabClient is one connected WebSocket peer.
type collabClient struct {
	id     uuid.UUID
	userID uuid.UUID
	conn   *websocket.Conn
	mu     sync.Mutex // guards Write calls
}

func (c *collabClient) send(ctx context.Context, msg []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.Write(ctx, websocket.MessageBinary, msg)
}

// collabRoom holds all clients editing the same document.
type collabRoom struct {
	mu      sync.RWMutex
	clients map[uuid.UUID]*collabClient
}

func (r *collabRoom) add(c *collabClient) {
	r.mu.Lock()
	r.clients[c.id] = c
	r.mu.Unlock()
}

func (r *collabRoom) remove(id uuid.UUID) {
	r.mu.Lock()
	delete(r.clients, id)
	r.mu.Unlock()
}

func (r *collabRoom) broadcast(ctx context.Context, from uuid.UUID, msg []byte) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, c := range r.clients {
		if id == from {
			continue
		}
		_ = c.send(ctx, msg)
	}
}

// globalCollabRooms is the in-process room registry.
var globalCollabRooms struct {
	mu    sync.RWMutex
	rooms map[uuid.UUID]*collabRoom
}

func init() {
	globalCollabRooms.rooms = make(map[uuid.UUID]*collabRoom)
}

func getOrCreateRoom(docID uuid.UUID) *collabRoom {
	globalCollabRooms.mu.Lock()
	defer globalCollabRooms.mu.Unlock()
	r, ok := globalCollabRooms.rooms[docID]
	if !ok {
		r = &collabRoom{clients: make(map[uuid.UUID]*collabClient)}
		globalCollabRooms.rooms[docID] = r
	}
	return r
}

func maybeDeleteRoom(docID uuid.UUID) {
	globalCollabRooms.mu.Lock()
	defer globalCollabRooms.mu.Unlock()
	r, ok := globalCollabRooms.rooms[docID]
	if !ok {
		return
	}
	r.mu.RLock()
	n := len(r.clients)
	r.mu.RUnlock()
	if n == 0 {
		delete(globalCollabRooms.rooms, docID)
	}
}

// writeVarUint encodes a uint64 as a lib0 variable-length integer.
func writeVarUint(buf *bytes.Buffer, n uint64) {
	for n >= 0x80 {
		buf.WriteByte(byte(n&0x7F) | 0x80)
		n >>= 7
	}
	buf.WriteByte(byte(n))
}

// encodeSyncMsg wraps a Y.js update as a sync update message [0, 2, len, ...data].
// msgType: 0 = sync, subType: 2 = update (messageYjsUpdate)
func encodeSyncUpdate(data []byte) []byte {
	var buf bytes.Buffer
	buf.WriteByte(0) // messageSync
	buf.WriteByte(2) // messageYjsUpdate
	writeVarUint(&buf, uint64(len(data)))
	buf.Write(data)
	return buf.Bytes()
}

// encodeEmptySyncStep1 returns [0, 0, 0] = msgSync, syncStep1, empty state vector.
func encodeEmptySyncStep1() []byte {
	return []byte{0, 0, 0}
}

// encodeEmptySyncStep2 returns [0, 1, 0] = msgSync, syncStep2, empty update.
func encodeEmptySyncStep2() []byte {
	return []byte{0, 1, 0}
}

// isSyncMsg returns true if the binary message is a Y.js sync message (first byte = 0).
func isSyncMsg(msg []byte) bool {
	return len(msg) > 0 && msg[0] == 0
}

// extractUpdateFromMsg extracts the raw update bytes from a sync step 2 or update message.
// msg format: [0, subType, varintLen, ...updateBytes]
func extractUpdateFromMsg(msg []byte) []byte {
	if len(msg) < 3 {
		return nil
	}
	// Skip [msgType, subType]
	r := bytes.NewReader(msg[2:])
	var n uint64
	var shift uint
	for {
		b, err := r.ReadByte()
		if err != nil {
			return nil
		}
		n |= uint64(b&0x7F) << shift
		if b < 0x80 {
			break
		}
		shift += 7
		if shift > 63 {
			return nil
		}
	}
	out := make([]byte, n)
	if _, err := r.Read(out); err != nil && n > 0 {
		return nil
	}
	return out
}

// handleCollabDocWS is GET /api/v1/courses/{course_code}/collab-docs/{doc_id}/ws.
// First message must be text JSON: {"authToken":"..."}.
func (d Deps) handleCollabDocWS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}
		if d.JWTSigner == nil || d.Pool == nil {
			apierr.WriteJSON(w, http.StatusServiceUnavailable, apierr.CodeInternal, "server misconfiguration")
			return
		}
		courseCode := chi.URLParam(r, "course_code")
		rawDocID := chi.URLParam(r, "doc_id")
		docID, err := uuid.Parse(rawDocID)
		if err != nil {
			http.Error(w, "invalid doc id", http.StatusBadRequest)
			return
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: []string{"*"},
		})
		if err != nil {
			return
		}
		defer func() { _ = conn.Close(websocket.StatusNormalClosure, "") }()

		// Auth: read first text message.
		authCtx, cancelAuth := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancelAuth()
		typ, b, err := conn.Read(authCtx)
		if err != nil || typ != websocket.MessageText {
			return
		}
		var m struct {
			AuthToken string `json:"authToken"`
		}
		if err := json.Unmarshal(b, &m); err != nil || m.AuthToken == "" {
			return
		}
		u, err := d.JWTSigner.Verify(r.Context(), m.AuthToken)
		if err != nil {
			return
		}
		userID, err := uuid.Parse(u.UserID)
		if err != nil {
			return
		}
		// Check course enrollment.
		has, err := enrollment.UserHasAccess(r.Context(), d.Pool, courseCode, userID)
		if err != nil || !has {
			return
		}
		// Verify document belongs to course.
		cid, err := course.GetIDByCourseCode(r.Context(), d.Pool, courseCode)
		if err != nil || cid == nil {
			return
		}
		ok, err := collabdocs.BelongsToCourse(r.Context(), d.Pool, *cid, docID)
		if err != nil || !ok {
			return
		}

		// Send all stored sync updates to the new client.
		updates, err := collabdocs.GetAllUpdates(r.Context(), d.Pool, docID)
		if err == nil {
			writeCtx, cancelWrite := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancelWrite()
			for _, upd := range updates {
				_ = conn.Write(writeCtx, websocket.MessageBinary, encodeSyncUpdate(upd))
			}
		}

		// Send empty sync step 1 to request the client's full state.
		{
			writeCtx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			_ = conn.Write(writeCtx, websocket.MessageBinary, encodeEmptySyncStep1())
			cancel()
		}

		// Register in the room.
		client := &collabClient{
			id:     uuid.New(),
			userID: userID,
			conn:   conn,
		}
		room := getOrCreateRoom(docID)
		room.add(client)
		defer func() {
			room.remove(client.id)
			maybeDeleteRoom(docID)
		}()

		runCtx, stop := context.WithCancel(r.Context())
		defer stop()

		for {
			msgType, data, err := conn.Read(runCtx)
			if err != nil {
				return
			}
			if msgType != websocket.MessageBinary {
				continue
			}
			if len(data) == 0 {
				continue
			}

			msgClass := data[0]
			switch msgClass {
			case 0: // Y.js sync message
				subType := byte(0)
				if len(data) > 1 {
					subType = data[1]
				}
				switch subType {
				case 0: // syncStep1: client requests server's state
					// Respond with empty syncStep2 and all updates.
					writeCtx, cancel := context.WithTimeout(runCtx, 10*time.Second)
					_ = client.send(writeCtx, encodeEmptySyncStep2())
					storedUpdates, _ := collabdocs.GetAllUpdates(writeCtx, d.Pool, docID)
					for _, upd := range storedUpdates {
						_ = client.send(writeCtx, encodeSyncUpdate(upd))
					}
					cancel()

				case 1, 2: // syncStep2 or update: contains document content
					// Extract the raw Y.js update and persist it.
					rawUpdate := extractUpdateFromMsg(data)
					if len(rawUpdate) > 0 {
						storeCtx, cancel := context.WithTimeout(runCtx, 5*time.Second)
						_ = collabdocs.StoreUpdate(storeCtx, d.Pool, docID, userID, rawUpdate)
						cancel()
					}
					// Relay the original message (including sync wrapper) to other clients.
					room.broadcast(runCtx, client.id, data)
				}

			case 1: // Y.js awareness — relay only, do not persist
				room.broadcast(runCtx, client.id, data)
			}
		}
	}
}
