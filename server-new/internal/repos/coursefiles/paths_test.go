package coursefiles

import (
	"path/filepath"
	"testing"
)

func TestBlobDiskPath_sanitizesCourseCode(t *testing.T) {
	p := BlobDiskPath("/data", "C-6AC8B6", "3f4e6c1c.dat")
	w := filepath.Clean(p)
	// C-6AC8B6 is all allowed ASCII; directory segment must match Rust layout.
	if got := filepath.Base(filepath.Dir(w)); got != "C-6AC8B6" {
		t.Fatalf("dir segment: %q", got)
	}
}

func TestBlobDiskPath_usesStorageKeyBase(t *testing.T) {
	p := BlobDiskPath("/root", "C-X", "evil/../k.bin")
	if filepath.Base(p) != "k.bin" {
		t.Fatalf("got %q", p)
	}
}
