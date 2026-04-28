package oidc

import (
	"context"
	"fmt"
)

// Runtime marks the internal OIDC package as a concrete module.
type Runtime struct {
	Provider string
}

func NewRuntime(provider string) Runtime {
	return Runtime{Provider: provider}
}

func (r Runtime) Health(ctx context.Context) (string, error) {
	if ctx == nil {
		return "", fmt.Errorf("context is nil")
	}
	if r.Provider == "" {
		return "oidc:ok", nil
	}
	return "oidc:" + r.Provider, nil
}
