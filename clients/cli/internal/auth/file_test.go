package auth_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lextures/lextures/clients/cli/internal/auth"
)

func tempFileStore(t *testing.T) (*fileStoreExposed, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, ".lextures-token")
	return &fileStoreExposed{path: path}, path
}

// fileStoreExposed wraps the internal fileStore by exercising it through the Store interface.
// We build a real fileStore via a helper exported for tests.
type fileStoreExposed struct {
	path string
}

func (e *fileStoreExposed) store() auth.Store {
	return auth.NewFileStoreAt(e.path)
}

func TestFileStore_SaveAndLoad(t *testing.T) {
	fe, _ := tempFileStore(t)
	s := fe.store()

	tok := &auth.TokenData{
		AccessToken:  "at",
		RefreshToken: "rt",
		Expiry:       time.Now().Add(time.Hour).Truncate(time.Second),
	}
	if err := s.Save("default", tok); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := s.Load("default")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if got == nil {
		t.Fatal("expected token, got nil")
	}
	if got.AccessToken != tok.AccessToken {
		t.Errorf("AccessToken = %q, want %q", got.AccessToken, tok.AccessToken)
	}
	if got.RefreshToken != tok.RefreshToken {
		t.Errorf("RefreshToken = %q, want %q", got.RefreshToken, tok.RefreshToken)
	}
}

func TestFileStore_MultipleProfiles(t *testing.T) {
	fe, _ := tempFileStore(t)
	s := fe.store()

	_ = s.Save("alice", &auth.TokenData{AccessToken: "alice-tok"})
	_ = s.Save("bob", &auth.TokenData{AccessToken: "bob-tok"})

	alice, _ := s.Load("alice")
	bob, _ := s.Load("bob")
	if alice == nil || alice.AccessToken != "alice-tok" {
		t.Errorf("alice = %+v", alice)
	}
	if bob == nil || bob.AccessToken != "bob-tok" {
		t.Errorf("bob = %+v", bob)
	}
}

func TestFileStore_Delete(t *testing.T) {
	fe, _ := tempFileStore(t)
	s := fe.store()

	_ = s.Save("default", &auth.TokenData{AccessToken: "gone"})
	if err := s.Delete("default"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ := s.Load("default")
	if got != nil {
		t.Errorf("expected nil after delete, got %+v", got)
	}
}

func TestFileStore_LoadMissingFile(t *testing.T) {
	fe, _ := tempFileStore(t)
	s := fe.store()

	got, err := s.Load("nonexistent")
	if err != nil {
		t.Fatalf("Load on missing file: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestFileStore_FilePermissions(t *testing.T) {
	fe, path := tempFileStore(t)
	s := fe.store()

	_ = s.Save("default", &auth.TokenData{AccessToken: "x"})

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("file permissions = %04o, want 0600", perm)
	}
}

func TestFileStore_Backend(t *testing.T) {
	fe, _ := tempFileStore(t)
	if b := fe.store().Backend(); b != "file" {
		t.Errorf("Backend = %q, want file", b)
	}
}
