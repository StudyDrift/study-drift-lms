package filestorage

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrNoPresignedURL is returned by drivers that do not support presigned URLs (e.g. local).
var ErrNoPresignedURL = errors.New("filestorage: presigned URLs not supported by this driver")

// Driver is the storage abstraction for putting, getting, and deleting objects.
type Driver interface {
	// PutObject writes r (of size bytes) to the object at key with the given MIME type.
	PutObject(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	// GetPresignedURL returns a short-lived URL for downloading the object.
	// Returns ErrNoPresignedURL for drivers that serve files directly.
	GetPresignedURL(ctx context.Context, key string, ttl time.Duration) (string, error)
	// DeleteObject removes the object at key. It is not an error if the key does not exist.
	DeleteObject(ctx context.Context, key string) error
	// ListObjects returns all keys under the given prefix.
	ListObjects(ctx context.Context, prefix string) ([]string, error)
}

// ObjectKey returns a canonical storage key: {tenantID}/{courseID}/{resourceType}/{name}
// ext should include the leading dot (e.g. ".pdf") or be empty.
func ObjectKey(tenantID, courseID, resourceType, name string) string {
	return tenantID + "/" + courseID + "/" + resourceType + "/" + name
}
