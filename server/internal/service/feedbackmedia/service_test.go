package feedbackmedia

import (
	"context"
	"testing"
)

func TestServiceHealth(t *testing.T) {
	s := New()
	if s.Name != "feedbackmedia" {
		t.Fatalf("name: %q", s.Name)
	}
	got, err := s.Health(context.Background())
	if err != nil || got != "feedbackmedia:ok" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}
