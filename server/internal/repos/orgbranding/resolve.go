package orgbranding

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const cacheTTL = 60 * time.Second

type cacheEntry struct {
	resolved Resolved
	expires  time.Time
}

// Resolved is the public branding payload for a hostname.
type Resolved struct {
	OrgID           *uuid.UUID `json:"orgId,omitempty"`
	OrgSlug         string     `json:"orgSlug,omitempty"`
	LogoURL         *string    `json:"logoUrl,omitempty"`
	FaviconURL      *string    `json:"faviconUrl,omitempty"`
	PrimaryColor    string     `json:"primaryColor"`
	SecondaryColor  string     `json:"secondaryColor"`
	CustomDomain    *string    `json:"customDomain,omitempty"`
	EmailDisplayName *string   `json:"customEmailDisplayName,omitempty"`
}

// Resolver resolves branding by HTTP host with in-process TTL cache.
type Resolver struct {
	mu      sync.RWMutex
	byHost  map[string]cacheEntry
	pool    *pgxpool.Pool
	suffix  string
	webHost string
}

// NewResolver constructs a resolver. suffix is the multitenant DNS suffix (e.g. "lextures.io"); empty disables subdomain routing.
// webHost is PUBLIC_WEB_ORIGIN host used to detect default (non-org) requests.
func NewResolver(pool *pgxpool.Pool, multitenantSuffix, publicWebOriginHost string) *Resolver {
	return &Resolver{
		byHost:  make(map[string]cacheEntry),
		pool:    pool,
		suffix:  strings.TrimSpace(strings.ToLower(multitenantSuffix)),
		webHost: NormalizeHost(publicWebOriginHost),
	}
}

// InvalidateHost drops cache entries for a host label or org-related refresh.
func (r *Resolver) InvalidateHost(host string) {
	h := NormalizeHost(host)
	r.mu.Lock()
	delete(r.byHost, h)
	r.mu.Unlock()
}

// InvalidateAll clears the cache (e.g. after branding update).
func (r *Resolver) InvalidateAll() {
	r.mu.Lock()
	r.byHost = make(map[string]cacheEntry)
	r.mu.Unlock()
}

// ResolveForHost returns branding for an incoming HTTP host (after NormalizeHost).
func (r *Resolver) ResolveForHost(ctx context.Context, hostHeader string) (Resolved, error) {
	h := NormalizeHost(hostHeader)
	if h == "" {
		return defaultResolved(), nil
	}
	now := time.Now()
	r.mu.RLock()
	e, ok := r.byHost[h]
	r.mu.RUnlock()
	if ok && now.Before(e.expires) {
		return e.resolved, nil
	}

	res, err := r.resolveUncached(ctx, h)
	if err != nil {
		return defaultResolved(), nil
	}
	r.mu.Lock()
	r.byHost[h] = cacheEntry{resolved: res, expires: now.Add(cacheTTL)}
	r.mu.Unlock()
	return res, nil
}

func defaultResolved() Resolved {
	return Resolved{
		PrimaryColor:   DefaultPrimaryHex,
		SecondaryColor: DefaultSecondaryHex,
	}
}

func (r *Resolver) resolveUncached(ctx context.Context, host string) (Resolved, error) {
	if r.pool == nil {
		return defaultResolved(), nil
	}
	// Default UI host → platform brand
	if r.webHost != "" && host == r.webHost {
		return defaultResolved(), nil
	}
	if id, err := OrgIDForCustomDomain(ctx, r.pool, host); err != nil {
		return Resolved{}, err
	} else if id != nil {
		return r.rowToResolved(ctx, *id)
	}
	if r.suffix != "" && strings.HasSuffix(host, "."+r.suffix) {
		sub := strings.TrimSuffix(host, "."+r.suffix)
		sub = strings.TrimSpace(strings.ToLower(sub))
		if sub != "" && sub != "www" && sub != "app" {
			if oid, err := OrgIDForSlug(ctx, r.pool, sub); err != nil {
				return Resolved{}, err
			} else if oid != nil {
				return r.rowToResolved(ctx, *oid)
			}
		}
	}
	return defaultResolved(), nil
}

func (r *Resolver) rowToResolved(ctx context.Context, orgID uuid.UUID) (Resolved, error) {
	slug, _ := OrgSlug(ctx, r.pool, orgID)
	row, err := Get(ctx, r.pool, orgID)
	if err != nil {
		return Resolved{}, err
	}
	out := Resolved{
		OrgID:          &orgID,
		OrgSlug:        slug,
		PrimaryColor:   DefaultPrimaryHex,
		SecondaryColor: DefaultSecondaryHex,
	}
	if row != nil {
		out.LogoURL = row.LogoURL
		out.FaviconURL = row.FaviconURL
		out.PrimaryColor = row.PrimaryColor
		out.SecondaryColor = row.SecondaryColor
		out.CustomDomain = row.CustomDomain
		out.EmailDisplayName = row.CustomEmailDisplayName
	}
	return out, nil
}
