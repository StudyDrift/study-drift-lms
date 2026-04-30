package conceptgraph

import "testing"

func TestSlugifyName(t *testing.T) {
	if got := SlugifyName("  Solving Linear Equations  "); got != "solving-linear-equations" {
		t.Fatalf("expected solving-linear-equations, got %q", got)
	}
	if got := SlugifyName("café"); got != "caf" {
		t.Fatalf("expected caf, got %q", got)
	}
}
