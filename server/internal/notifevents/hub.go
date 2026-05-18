// Package notifevents provides an in-memory pub/sub hub for real-time in-app notification updates via SSE.
package notifevents

import (
	"sync"

	"github.com/google/uuid"
)

// Hub fans out notification signals to SSE clients per user.
type Hub struct {
	mu      sync.RWMutex
	clients map[uuid.UUID]map[uint64]chan struct{}
	seq     uint64
}

// New returns a new Hub.
func New() *Hub {
	return &Hub{clients: make(map[uuid.UUID]map[uint64]chan struct{})}
}

// Subscribe registers an SSE listener for userID. Returns a channel that receives
// a signal when a new notification arrives, and a function to unsubscribe.
func (h *Hub) Subscribe(userID uuid.UUID) (<-chan struct{}, func()) {
	if h == nil {
		ch := make(chan struct{}, 1)
		return ch, func() {}
	}
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	h.seq++
	id := h.seq
	if h.clients[userID] == nil {
		h.clients[userID] = make(map[uint64]chan struct{})
	}
	h.clients[userID][id] = ch
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.clients[userID], id)
		if len(h.clients[userID]) == 0 {
			delete(h.clients, userID)
		}
		h.mu.Unlock()
	}
}

// Notify sends a signal to all SSE listeners for userID (non-blocking; drops on full channel).
func (h *Hub) Notify(userID uuid.UUID) {
	if h == nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ch := range h.clients[userID] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
