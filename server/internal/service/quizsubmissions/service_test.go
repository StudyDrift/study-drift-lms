package quizsubmissions

import (
	"context"
	"testing"
)

func TestServiceHealth(t *testing.T) {
	s := New()
	if s.Name != "quizsubmissions" {
		t.Fatalf("name: %q", s.Name)
	}
	got, err := s.Health(context.Background())
	if err != nil || got != "quizsubmissions:ok" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	if _, err := s.Health(nil); err == nil {
		t.Fatal("expected error for nil ctx")
	}
}
