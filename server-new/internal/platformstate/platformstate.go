// Package platformstate holds the effective merged configuration and OpenRouter client (reloadable).
package platformstate

import (
	"strings"
	"sync"

	"github.com/lextures/lextures/server-new/internal/config"
	"github.com/lextures/lextures/server-new/internal/service/openrouter"
)

// Platform is the request-time snapshot of env + DB merged settings.
type Platform struct {
	mu         sync.RWMutex
	cfg        config.Config
	openRouter *openrouter.Client
}

// New builds state from merged configuration (OpenRouter client only when API key is non-empty).
func New(cfg config.Config) *Platform {
	p := &Platform{cfg: cfg}
	if k := strings.TrimSpace(cfg.OpenRouterAPIKey); k != "" {
		p.openRouter = openrouter.NewClient(k)
	}
	return p
}

// Config returns the effective merged configuration.
func (p *Platform) Config() config.Config {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cfg
}

// OpenRouter returns the chat client, or nil when no API key is configured.
func (p *Platform) OpenRouter() *openrouter.Client {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.openRouter
}

// Reload replaces configuration and rebuilds the OpenRouter client when the key changes.
func (p *Platform) Reload(cfg config.Config) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cfg = cfg
	var next *openrouter.Client
	if k := strings.TrimSpace(cfg.OpenRouterAPIKey); k != "" {
		next = openrouter.NewClient(k)
	}
	p.openRouter = next
}
