package db

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestNewPool_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("needs DATABASE_URL for Postgres")
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("set DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	p, err := NewPool(ctx, dsn)
	if err != nil {
		t.Fatalf("new pool: %v", err)
	}
	defer p.Close()
	if err := p.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
}
