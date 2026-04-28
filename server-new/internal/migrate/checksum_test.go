package migrate

import "testing"

func TestSQLxChecksum_Length(t *testing.T) {
	s := sqlxChecksum([]byte("x"))
	if len(s[:]) != 48 {
		t.Fatalf("sha384: %d bytes", len(s))
	}
}
