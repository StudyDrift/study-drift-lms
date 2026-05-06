package codeexecution

import (
	"context"
	"testing"
)

func TestServiceHealth(t *testing.T) {
	s := New()
	if s.Name != "codeexecution" {
		t.Fatalf("name: %q", s.Name)
	}
	got, err := s.Health(context.Background())
	if err != nil || got != "codeexecution:ok" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}
