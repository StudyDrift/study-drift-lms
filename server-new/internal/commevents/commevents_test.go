package commevents

import (
	"testing"

	"github.com/google/uuid"
)

func TestHub_Broadcast_Filters_By_Receiver(t *testing.T) {
	t.Parallel()
	h := New()
	a := uuid.New()
	recv, unsub := h.Subscribe()
	defer unsub()
	h.Broadcast(a, `{"type":"mailbox_updated"}`)
	select {
	case ev := <-recv:
		if ev.UserID != a {
			t.Fatalf("userId: %v", ev.UserID)
		}
		if ev.JSON != `{"type":"mailbox_updated"}` {
			t.Fatalf("json: %s", ev.JSON)
		}
	}
}

func TestHub_Nil_NoPanic(t *testing.T) {
	t.Parallel()
	var h *Hub
	h.Broadcast(uuid.New(), "x")
	recv, unsub := h.Subscribe()
	defer unsub()
	_, open := <-recv
	if open {
		t.Fatalf("expected closed stream from nil hub")
	}
}
