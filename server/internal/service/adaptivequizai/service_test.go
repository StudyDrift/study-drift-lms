package adaptivequizai

import (
	"context"
	"testing"
)

func TestServiceHealth(t *testing.T) {
	s := New()
	if s.Name != "adaptivequizai" {
		t.Fatalf("name: %q", s.Name)
	}
	got, err := s.Health(context.Background())
	if err != nil || got != "adaptivequizai:ok" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}
