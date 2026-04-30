package db

import (
	"context"
	"testing"
)

func TestNewPool_Empty(t *testing.T) {
	_, err := NewPool(context.Background(), "")
	if err == nil {
		t.Fatal("expected error")
	}
}
