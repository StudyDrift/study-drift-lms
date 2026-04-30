package relativeschedule

import (
	"context"
	"fmt"
)

// Service is a tiny wiring type; real date shifting lives in `internal/relativeschedule` and is re-exported here.
type Service struct {
	Name string
}

func New() Service {
	return Service{Name: "relativeschedule"}
}

// Health returns a stable service heartbeat string for wiring/tests.
func (s Service) Health(ctx context.Context) (string, error) {
	if ctx == nil {
		return "", fmt.Errorf("context is nil")
	}
	return s.Name + ":ok", nil
}
