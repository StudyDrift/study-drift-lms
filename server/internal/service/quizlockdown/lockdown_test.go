package quizlockdown

import "testing"

func TestParseLockdownMode(t *testing.T) {
	if m, ok := ParseLockdownModeSetting("  kiosk "); !ok || m != LockdownKiosk {
		t.Fatalf("got %q %v", m, ok)
	}
	if _, ok := ParseLockdownModeSetting("nope"); ok {
		t.Fatal("expected invalid")
	}
}
