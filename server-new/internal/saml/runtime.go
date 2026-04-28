package saml

import (
	"context"
	"fmt"
)

// Runtime marks the internal SAML package as a concrete module.
type Runtime struct {
	Enabled bool
}

func NewRuntime(enabled bool) Runtime {
	return Runtime{Enabled: enabled}
}

func (r Runtime) Health(ctx context.Context) (string, error) {
	if ctx == nil {
		return "", fmt.Errorf("context is nil")
	}
	if r.Enabled {
		return "saml:enabled", nil
	}
	return "saml:disabled", nil
}
