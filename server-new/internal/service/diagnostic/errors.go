package diagnostic

import "errors"

// Sentinel errors mapped to HTTP status in handlers.
var (
	ErrForbidden = errors.New("forbidden")
	ErrNotFound  = errors.New("not found")
)
