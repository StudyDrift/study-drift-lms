package authservice

import (
	"expvar"
	"sync/atomic"
)

var magicLinkMetrics = struct {
	requested   atomic.Uint64
	consumed    atomic.Uint64
	expired     atomic.Uint64
	rateLimited atomic.Uint64
}{}

func init() {
	expvar.Publish("magic_link.requested_total", expvar.Func(func() any {
		return magicLinkMetrics.requested.Load()
	}))
	expvar.Publish("magic_link.consumed_total", expvar.Func(func() any {
		return magicLinkMetrics.consumed.Load()
	}))
	expvar.Publish("magic_link.expired_total", expvar.Func(func() any {
		return magicLinkMetrics.expired.Load()
	}))
	expvar.Publish("magic_link.rate_limited_total", expvar.Func(func() any {
		return magicLinkMetrics.rateLimited.Load()
	}))
}
