// Package db wraps PostgreSQL connection pooling.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool returns a [pgxpool.Pool] for the given DSN.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	if dsn == "" {
		return nil, fmt.Errorf("empty database url")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	// MaxConns in line with the Rust `db::connect` (10)
	cfg.MaxConns = 10
	return pgxpool.NewWithConfig(ctx, cfg)
}

// Ready returns nil when the schema is present enough for the service to run the `/health/ready` check
// (same idea as the Rust `routes::health::ready` handler).
func Ready(ctx context.Context, pool *pgxpool.Pool) error {
	// Same query shape as the Rust server: `SELECT hero_image_url FROM course.courses LIMIT 0`
	_, err := pool.Exec(ctx, `SELECT hero_image_url FROM course.courses LIMIT 0`)
	return err
}
