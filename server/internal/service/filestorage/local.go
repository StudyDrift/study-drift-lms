package filestorage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LocalDriver stores objects on the local filesystem under Root.
// It does not support presigned URLs; callers must serve file bytes directly.
type LocalDriver struct {
	Root string
}

func (d *LocalDriver) PutObject(ctx context.Context, key string, r io.Reader, _ int64, _ string) error {
	p := d.keyPath(key)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return fmt.Errorf("filestorage/local: mkdir: %w", err)
	}
	f, err := os.Create(p)
	if err != nil {
		return fmt.Errorf("filestorage/local: create: %w", err)
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return fmt.Errorf("filestorage/local: write: %w", err)
	}
	return nil
}

func (d *LocalDriver) GetPresignedURL(_ context.Context, _ string, _ time.Duration) (string, error) {
	return "", ErrNoPresignedURL
}

func (d *LocalDriver) DeleteObject(_ context.Context, key string) error {
	return os.Remove(d.keyPath(key))
}

func (d *LocalDriver) ListObjects(_ context.Context, prefix string) ([]string, error) {
	dir := filepath.Join(d.Root, filepath.FromSlash(prefix))
	var keys []string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(d.Root, path)
		if relErr == nil {
			keys = append(keys, filepath.ToSlash(rel))
		}
		return nil
	})
	return keys, err
}

// ReadFile reads the raw bytes for a key (used when serving local files directly).
func (d *LocalDriver) ReadFile(key string) ([]byte, error) {
	return os.ReadFile(d.keyPath(key))
}

func (d *LocalDriver) keyPath(key string) string {
	// Sanitize key to prevent directory traversal
	clean := filepath.Clean(filepath.FromSlash(key))
	if strings.HasPrefix(clean, "..") {
		clean = "_invalid_" + clean
	}
	return filepath.Join(d.Root, clean)
}
