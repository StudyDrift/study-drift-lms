package notifevents

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestHub_NotifySubscribers(t *testing.T) {
	t.Parallel()
	h := New()
	userID := uuid.New()

	ch, unsub := h.Subscribe(userID)
	defer unsub()

	h.Notify(userID)

	select {
	case <-ch:
		// received signal
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected notification signal within 100ms")
	}
}

func TestHub_NoSignalForDifferentUser(t *testing.T) {
	t.Parallel()
	h := New()
	a := uuid.New()
	b := uuid.New()

	ch, unsub := h.Subscribe(a)
	defer unsub()

	h.Notify(b)

	select {
	case <-ch:
		t.Fatal("should not receive signal for different user")
	case <-time.After(20 * time.Millisecond):
		// correct — no signal
	}
}

func TestHub_UnsubscribeStopsSignals(t *testing.T) {
	t.Parallel()
	h := New()
	userID := uuid.New()

	ch, unsub := h.Subscribe(userID)
	unsub()

	h.Notify(userID)

	select {
	case <-ch:
		t.Fatal("should not receive signal after unsubscribe")
	case <-time.After(20 * time.Millisecond):
		// correct
	}
}

func TestHub_NilSafe(t *testing.T) {
	t.Parallel()
	var h *Hub
	h.Notify(uuid.New())
	ch, unsub := h.Subscribe(uuid.New())
	defer unsub()
	_ = ch
}

func TestHub_MultipleSubscribers(t *testing.T) {
	t.Parallel()
	h := New()
	userID := uuid.New()

	ch1, unsub1 := h.Subscribe(userID)
	ch2, unsub2 := h.Subscribe(userID)
	defer unsub1()
	defer unsub2()

	h.Notify(userID)

	for _, ch := range []<-chan struct{}{ch1, ch2} {
		select {
		case <-ch:
		case <-time.After(100 * time.Millisecond):
			t.Fatal("expected signal on all subscribers")
		}
	}
}
