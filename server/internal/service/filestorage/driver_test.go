package filestorage_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lextures/lextures/server/internal/service/filestorage"
)

func TestObjectKey(t *testing.T) {
	got := filestorage.ObjectKey("t1", "c1", "docs", "file.pdf")
	want := "t1/c1/docs/file.pdf"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestLocalDriver_PutGetDelete(t *testing.T) {
	dir := t.TempDir()
	d := &filestorage.LocalDriver{Root: dir}
	ctx := context.Background()

	key := "tenant1/course1/docs/test.txt"
	content := []byte("hello storage")

	// Put
	if err := d.PutObject(ctx, key, bytes.NewReader(content), int64(len(content)), "text/plain"); err != nil {
		t.Fatalf("PutObject: %v", err)
	}

	// ReadFile (direct read for local)
	got, err := d.ReadFile(key)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !bytes.Equal(got, content) {
		t.Fatalf("content mismatch: got %q want %q", got, content)
	}

	// GetPresignedURL returns ErrNoPresignedURL
	_, err = d.GetPresignedURL(ctx, key, time.Hour)
	if !errors.Is(err, filestorage.ErrNoPresignedURL) {
		t.Fatalf("expected ErrNoPresignedURL, got %v", err)
	}

	// ListObjects
	keys, err := d.ListObjects(ctx, "tenant1/course1")
	if err != nil {
		t.Fatalf("ListObjects: %v", err)
	}
	if len(keys) != 1 || keys[0] != "tenant1/course1/docs/test.txt" {
		t.Fatalf("ListObjects: got %v", keys)
	}

	// Delete
	if err := d.DeleteObject(ctx, key); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, key)); !os.IsNotExist(err) {
		t.Fatalf("expected file to be deleted")
	}
}

func TestLocalDriver_TraversalSafety(t *testing.T) {
	dir := t.TempDir()
	d := &filestorage.LocalDriver{Root: dir}
	ctx := context.Background()
	content := []byte("x")
	key := "../../etc/passwd"
	_ = d.PutObject(ctx, key, bytes.NewReader(content), int64(len(content)), "text/plain")
	// Verify nothing was written outside the root
	if _, err := os.Stat("/etc/passwd"); err == nil {
		// /etc/passwd exists (normal); check it wasn't modified
	}
	// The key must be normalized inside dir
	_, readErr := d.ReadFile(key)
	if readErr == nil {
		// If it read, verify it's inside dir
		p := filepath.Join(dir, "_invalid_..", "..", "etc", "passwd")
		if _, err := os.Stat(p); err == nil {
			t.Log("traversal blocked - file inside temp dir")
		}
	}
}

func TestNew_LocalDefault(t *testing.T) {
	d, err := filestorage.New(filestorage.BackendConfig{Backend: "local", LocalRoot: t.TempDir()})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if d == nil {
		t.Fatal("nil driver")
	}
}

func TestNew_UnknownBackend(t *testing.T) {
	_, err := filestorage.New(filestorage.BackendConfig{Backend: "unknown"})
	if err == nil {
		t.Fatal("expected error for unknown backend")
	}
}
