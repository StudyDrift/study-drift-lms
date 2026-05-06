package orgbranding_test

import (
	"testing"

	"github.com/lextures/lextures/server/internal/repos/orgbranding"
)

func TestValidateHexColor_OK(t *testing.T) {
	t.Parallel()
	got, err := orgbranding.ValidateHexColor("#aabbCC")
	if err != nil {
		t.Fatal(err)
	}
	if got != "#AABBCC" {
		t.Fatalf("got %q", got)
	}
}

func TestContrastAgainstWhite_LowRatio(t *testing.T) {
	t.Parallel()
	ok, ratio, err := orgbranding.MeetsWCAGAANormalText("#CCCCCC")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected fail")
	}
	if ratio >= 4.5 {
		t.Fatalf("ratio %v", ratio)
	}
}
