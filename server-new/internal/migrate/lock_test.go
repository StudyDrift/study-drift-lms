package migrate

import "testing"

func TestGenerateLockID_Stable(t *testing.T) {
	const name = "studydrift_test"
	x := generateLockID(name)
	if y := generateLockID(name); x != y {
		t.Fatalf("unstable: %d vs %d", x, y)
	}
	if generateLockID("a") == generateLockID("b") {
		t.Fatalf("expected different ids for different dbs")
	}
}
