package enrollments

import (
	"context"
	"fmt"
)

// Service provides the Go port boundary for Rust service `enrollments`.
type Service struct {
	Name string
}

func New() Service {
	return Service{Name: "enrollments"}
}

// Health returns a stable service heartbeat string for wiring/tests.
func (s Service) Health(ctx context.Context) (string, error) {
	if ctx == nil {
		return "", fmt.Errorf("context is nil")
	}
	return s.Name + ":ok", nil
}
