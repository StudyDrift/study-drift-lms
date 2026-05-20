// Package test holds end-to-end tests.
package test

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

// TestStorageE2E_LocalDriver exercises the full local driver lifecycle:
// put → presign (expect ErrNoPresignedURL) → list → delete.
func TestStorageE2E_LocalDriver(t *testing.T) {
	dir := t.TempDir()
	d, err := filestorage.New(filestorage.BackendConfig{Backend: "local", LocalRoot: dir})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx := context.Background()

	key := filestorage.ObjectKey("tenant-1", "course-1", "docs", "lecture.pdf")
	content := []byte("PDF content placeholder")

	// 1. Put object
	if err := d.PutObject(ctx, key, bytes.NewReader(content), int64(len(content)), "application/pdf"); err != nil {
		t.Fatalf("PutObject: %v", err)
	}

	// 2. Verify file exists on disk
	diskPath := filepath.Join(dir, filepath.FromSlash(key))
	if _, err := os.Stat(diskPath); err != nil {
		t.Fatalf("expected file on disk: %v", err)
	}

	// 3. Presigned URL returns ErrNoPresignedURL for local driver
	_, presignErr := d.GetPresignedURL(ctx, key, time.Hour)
	if !errors.Is(presignErr, filestorage.ErrNoPresignedURL) {
		t.Fatalf("expected ErrNoPresignedURL got %v", presignErr)
	}

	// 4. List objects finds the uploaded file
	keys, err := d.ListObjects(ctx, "tenant-1/course-1")
	if err != nil {
		t.Fatalf("ListObjects: %v", err)
	}
	found := false
	for _, k := range keys {
		if k == key {
			found = true
		}
	}
	if !found {
		t.Fatalf("key %q not found in ListObjects result %v", key, keys)
	}

	// 5. Delete object
	if err := d.DeleteObject(ctx, key); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}
	if _, err := os.Stat(diskPath); !os.IsNotExist(err) {
		t.Fatalf("expected file to be deleted")
	}

	// 6. Verify local driver can read file (using LocalDriver directly)
	ld := d.(*filestorage.LocalDriver)
	if err := ld.PutObject(ctx, key, bytes.NewReader(content), int64(len(content)), "application/pdf"); err != nil {
		t.Fatalf("re-put: %v", err)
	}
	readBack, err := ld.ReadFile(key)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !bytes.Equal(readBack, content) {
		t.Fatalf("content mismatch after read")
	}
}

// TestStorageE2E_Factory tests factory creation for all static backends.
func TestStorageE2E_Factory(t *testing.T) {
	cases := []struct {
		backend string
		wantErr bool
	}{
		{"local", false},
		{"", false},
		{"unknown", true},
	}
	for _, tc := range cases {
		root := ""
		if !tc.wantErr {
			root = t.TempDir()
		}
		_, err := filestorage.New(filestorage.BackendConfig{Backend: tc.backend, LocalRoot: root})
		if tc.wantErr && err == nil {
			t.Errorf("backend=%q: expected error", tc.backend)
		}
		if !tc.wantErr && err != nil {
			t.Errorf("backend=%q: unexpected error: %v", tc.backend, err)
		}
	}
}

// TestStorageE2E_ObjectKeyScheme verifies the key format.
func TestStorageE2E_ObjectKeyScheme(t *testing.T) {
	key := filestorage.ObjectKey("org-123", "course-456", "videos", "lecture-01.mp4")
	want := "org-123/course-456/videos/lecture-01.mp4"
	if key != want {
		t.Fatalf("got %q want %q", key, want)
	}
}
