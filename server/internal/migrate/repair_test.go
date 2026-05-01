package migrate

import (
	"encoding/hex"
	"testing"
)

func TestChecksumMigration120ShortB3302c2HexDecodesTo48Bytes(t *testing.T) {
	b, err := hex.DecodeString(checksumMigration120ShortB3302c2Hex)
	if err != nil {
		t.Fatal(err)
	}
	if len(b) != 48 {
		t.Fatalf("want 48-byte SHA-384 digest, got %d", len(b))
	}
}
