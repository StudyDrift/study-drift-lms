package irt

import (
	"math"
	"math/rand"
	"testing"
)

func TestEapSingleCorrectItemPushesThetaUp(t *testing.T) {
	r := [][3]float64{{1, 0, 1}}
	theta, se := EapTheta2pl(r)
	if theta <= 0.2 {
		t.Fatalf("theta=%v want >0.2", theta)
	}
	if se <= 0 || se >= 2 {
		t.Fatalf("se=%v", se)
	}
	if math.Abs(theta) > 4 || !isFinite64(theta) {
		t.Fatalf("theta=%v", theta)
	}
}

func TestEapWrongOnHardItemPullsThetaDown(t *testing.T) {
	r := [][3]float64{{1.5, 1.5, 0}}
	theta, _ := EapTheta2pl(r)
	if theta >= 0.1 {
		t.Fatalf("theta=%v want <0.1", theta)
	}
}

func TestFisherInformationPeakNearB(t *testing.T) {
	a, b := 1.2, 0.5
	i0 := FisherInformation2pl(b, a, b)
	i1 := FisherInformation2pl(b-1.5, a, b)
	if i0 <= i1 {
		t.Fatalf("i0=%v i1=%v", i0, i1)
	}
}

func TestSyntheticCalibrationRecoversBRoughly(t *testing.T) {
	const aTrue, bTrue = 1.2, 0.5
	rng := rand.New(rand.NewSource(42))
	resp := make([]byte, 250)
	for i := range resp {
		theta := rng.Float64()*5.0 - 2.5
		p := Prob2pl(theta, aTrue, bTrue)
		if rng.Float64() < p {
			resp[i] = 1
		} else {
			resp[i] = 0
		}
	}
	aHat, bHat, ok := Calibrate2plMarginalGrid(resp)
	if !ok {
		t.Fatal("expected calibration")
	}
	if !isFinite64(aHat) || !isFinite64(bHat) {
		t.Fatalf("a=%v b=%v", aHat, bHat)
	}
	if aHat < 0.3 || aHat > 3.0 {
		t.Fatalf("a_hat=%v", aHat)
	}
	if bHat < -3.5 || bHat > 3.5 {
		t.Fatalf("b_hat=%v", bHat)
	}
	if math.Abs(bHat-bTrue) >= 1.2501 {
		t.Fatalf("b_hat=%v b_true=%v", bHat, bTrue)
	}
}
