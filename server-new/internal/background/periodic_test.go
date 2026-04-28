package background

import (
	"context"
	"testing"
	"time"
)

func TestRunEvery_stopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	ch := make(chan struct{})
	go func() {
		runEvery(ctx, 2*time.Millisecond, func() { calls++ })
		close(ch)
	}()
	time.Sleep(8 * time.Millisecond)
	cancel()
	<-ch
	if calls < 1 {
		t.Fatalf("expected at least one tick, got %d", calls)
	}
}
