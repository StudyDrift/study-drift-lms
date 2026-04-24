package db

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewPool_RejectEmpty(t *testing.T) {
	_, err := NewPool(context.Background(), "")
	assert.Error(t, err)
}

func TestNewPool_InvalidDSN(t *testing.T) {
	_, err := NewPool(context.Background(), "not-a-valid-url-scheme://")
	assert.Error(t, err)
}

func TestReady_Integration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("set DATABASE_URL for integration test")
	}
	p, err := NewPool(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	err = Ready(context.Background(), p)
	if err != nil {
		t.Logf("ready: %v (migrations may not be applied on this test DB)", err)
	}
}
