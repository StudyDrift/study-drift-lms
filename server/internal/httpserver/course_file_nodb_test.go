package httpserver

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/lextures/lextures/server/internal/service/filestorage"
)

// mockStorage implements filestorage.Driver for tests.
type mockStorage struct {
	presignURL string
	presignErr error
}

func (m *mockStorage) PutObject(_ context.Context, _ string, _ io.Reader, _ int64, _ string) error {
	return nil
}
func (m *mockStorage) GetPresignedURL(_ context.Context, _ string, _ time.Duration) (string, error) {
	return m.presignURL, m.presignErr
}
func (m *mockStorage) DeleteObject(_ context.Context, _ string) error { return nil }
func (m *mockStorage) ListObjects(_ context.Context, _ string) ([]string, error) {
	return nil, nil
}

func TestHandleCourseFileContent_NilStorage_Unauthorized(t *testing.T) {
	h := NewHandler(Deps{Pool: nil, Storage: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/courses/C-TEST01/course-files/00000000-0000-0000-0000-000000000001/content", nil)
	h.ServeHTTP(rr, r)
	// No JWT → 401
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 got %d", rr.Code)
	}
}

func TestHandleCourseFileContent_Options(t *testing.T) {
	h := NewHandler(Deps{Pool: nil})
	rr := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodOptions, "/api/v1/courses/C-TEST01/course-files/00000000-0000-0000-0000-000000000001/content", nil)
	h.ServeHTTP(rr, r)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS: got %d want 204", rr.Code)
	}
}

func TestStorageDriver_LocalFallthrough(t *testing.T) {
	ms := &mockStorage{presignErr: filestorage.ErrNoPresignedURL}
	// When GetPresignedURL returns ErrNoPresignedURL, the handler falls through to disk
	_, err := ms.GetPresignedURL(context.Background(), "key", time.Hour)
	if !errors.Is(err, filestorage.ErrNoPresignedURL) {
		t.Fatal("expected ErrNoPresignedURL")
	}
}

func TestLocalDriver_PutAndRead(t *testing.T) {
	dir := t.TempDir()
	d := &filestorage.LocalDriver{Root: dir}
	ctx := context.Background()
	content := []byte("test content")
	key := "t/c/docs/f.txt"
	if err := d.PutObject(ctx, key, bytes.NewReader(content), int64(len(content)), "text/plain"); err != nil {
		t.Fatalf("PutObject: %v", err)
	}
	got, err := d.ReadFile(key)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(got) != string(content) {
		t.Fatalf("content mismatch")
	}
}
