// Package commevents is an in-memory pub/sub for mailbox realtime updates, mirroring
// the Rust server's tokio::sync::broadcast used by routes/communication.
package commevents

import (
	"sync"

	"github.com/google/uuid"
)

// Event is broadcast to all WebSocket subscribers; each client filters on UserID.
type Event struct {
	UserID uuid.UUID
	JSON   string
}

// Hub fans out events to all subscribers; subscribers drop on slow reads (non-blocking send).
type Hub struct {
	mu   sync.RWMutex
	subs map[uint64]chan Event
	n    uint64
}

// New returns a new hub. One Hub per process is typical.
func New() *Hub {
	return &Hub{subs: make(map[uint64]chan Event)}
}

// Broadcast sends a JSON payload to all subscribers, tagged with a user to filter on the client side.
func (h *Hub) Broadcast(userID uuid.UUID, json string) {
	if h == nil {
		return
	}
	ev := Event{UserID: userID, JSON: json}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ch := range h.subs {
		select {
		case ch <- ev:
		default: // slow consumer: drop like an overloaded tokio buffer
		}
	}
}

// Subscribe returns a stream of all events. Call unsubscribe() when the consumer exits.
func (h *Hub) Subscribe() (recv <-chan Event, unsubscribe func()) {
	if h == nil {
		ch := make(chan Event)
		close(ch)
		return ch, func() {}
	}
	ch := make(chan Event, 4)
	h.mu.Lock()
	h.n++
	id := h.n
	h.subs[id] = ch
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, id)
		close(ch)
		h.mu.Unlock()
	}
}
