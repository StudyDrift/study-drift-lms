package moderatedgrading

import "testing"

func TestThreshold15PercentOf100Points(t *testing.T) {
	pw := int32(100)
	if ProvisionalScoresExceedThreshold(70, 84, &pw, 15) {
		t.Fatal("70–84 should not exceed 15% of 100")
	}
	if !ProvisionalScoresExceedThreshold(70, 90, &pw, 15) {
		t.Fatal("70–90 should exceed 15% of 100")
	}
}
