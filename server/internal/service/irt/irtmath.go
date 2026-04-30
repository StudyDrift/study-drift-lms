// Package irt contains pure 2PL IRT helpers (port of server/src/services/irt.rs). No I/O.
package irt

import (
	"math"
	"sort"

	"github.com/google/uuid"
)

const (
	thetaGridMin  = -4.0
	thetaGridMax  = 4.0
	thetaGridStep = 0.05
	thetaClamp    = 4.0
)

func isFinite64(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}

// CatModeEnabled mirrors IRT_CAT_MODE_ENABLED (default false).
func CatModeEnabled() bool {
	// Defer to env in a single place; avoid importing os in multiple tests.
	return catModeEnabled()
}

// Prob2pl is 2PL probability of a correct response at latent ability theta.
func Prob2pl(theta, a, b float64) float64 {
	x := a * (theta - b)
	if x >= 0 {
		e := math.Exp(-x)
		return 1.0 / (1.0 + e)
	}
	e := math.Exp(x)
	return e / (1.0 + e)
}

// FisherInformation2pl is Fisher information for a 2PL item at theta.
func FisherInformation2pl(theta, a, b float64) float64 {
	p := Prob2pl(theta, a, b)
	q := 1.0 - p
	return a * a * p * q
}

func normalPDF(x float64) float64 {
	return math.Exp(-0.5*x*x) / math.Sqrt(2*math.Pi)
}

func thetaGrid() []float64 {
	var v []float64
	for t := thetaGridMin; t <= thetaGridMax+1e-9; t += thetaGridStep {
		v = append(v, t)
	}
	return v
}

// EapTheta2pl is EAP estimate of θ with standard normal prior; dichotomous u∈{0,1}. Empty → (0,1).
// responses: (a, b, u) per item.
func EapTheta2pl(responses [][3]float64) (float64, float64) {
	grid := thetaGrid()
	if len(responses) == 0 {
		return 0, 1
	}
	w := make([]float64, len(grid))
	for i, theta := range grid {
		lp := math.Log(normalPDF(theta))
		if !isFinite64(lp) {
			lp = -1e300
		}
		for _, row := range responses {
			a, b, u := row[0], row[1], row[2]
			p := Prob2pl(theta, a, b)
			if p < 1e-9 {
				p = 1e-9
			}
			if p > 1-1e-9 {
				p = 1 - 1e-9
			}
			if u >= 0.5 {
				lp += math.Log(p)
			} else {
				lp += math.Log(1.0 - p)
			}
		}
		w[i] = lp
	}
	wmax := math.Inf(-1)
	for _, x := range w {
		if x > wmax {
			wmax = x
		}
	}
	for i := range w {
		w[i] = math.Exp(w[i] - wmax)
	}
	var sum float64
	for i := range w {
		sum += w[i]
	}
	if sum <= 0 || !isFinite64(sum) {
		return 0, 1
	}
	for i := range w {
		w[i] /= sum
	}
	var mean, mean2 float64
	for i, theta := range grid {
		mean += theta * w[i]
		mean2 += theta * theta * w[i]
	}
	varF := mean2 - mean*mean
	if varF < 1e-12 {
		varF = 1e-12
	}
	se := math.Sqrt(varF)
	out := mean
	if out < -thetaClamp {
		out = -thetaClamp
	}
	if out > thetaClamp {
		out = thetaClamp
	}
	return out, se
}

// SelectMaxInformationItem picks the candidate with highest Fisher information at theta.
// candidates: (questionID, a, b). Excludes ids in exclude. If calibratedOnly, skips items without a,b.
func SelectMaxInformationItem(
	theta float64,
	candidates []struct {
		ID   uuid.UUID
		A, B *float64
	},
	exclude []uuid.UUID,
	calibratedOnly bool,
) *uuid.UUID {
	excludeSet := make(map[uuid.UUID]struct{}, len(exclude))
	for _, e := range exclude {
		excludeSet[e] = struct{}{}
	}
	var best *uuid.UUID
	var bestInfo float64
	for _, c := range candidates {
		if _, ok := excludeSet[c.ID]; ok {
			continue
		}
		var a, b float64
		ok := false
		if c.A != nil && c.B != nil && *c.A > 0.01 && isFinite64(*c.A) && isFinite64(*c.B) {
			a, b, ok = *c.A, *c.B, true
		} else if !calibratedOnly {
			a, b, ok = 1, 0, true
		}
		if !ok {
			continue
		}
		info := FisherInformation2pl(theta, a, b)
		if best == nil || info > bestInfo {
			id := c.ID
			best = &id
			bestInfo = info
		}
	}
	return best
}

// MarginalLogLik2plItem is marginal log-likelihood for one 2PL item, θ~N(0,1), coarse grid.
func MarginalLogLik2plItem(a, b float64, responses []byte) float64 {
	nodes := [21]float64{
		-4.0, -3.6, -3.2, -2.8, -2.4, -2.0, -1.6, -1.2, -0.8, -0.4, 0.0, 0.4, 0.8, 1.2, 1.6, 2.0,
		2.4, 2.8, 3.2, 3.6, 4.0,
	}
	var total float64
	for _, u := range responses {
		var acc, norm float64
		for _, theta := range nodes {
			w := normalPDF(theta)
			norm += w
			p := Prob2pl(theta, a, b)
			if p < 1e-9 {
				p = 1e-9
			}
			if p > 1-1e-9 {
				p = 1 - 1e-9
			}
			if u == 1 {
				acc += w * math.Log(p)
			} else {
				acc += w * math.Log(1.0-p)
			}
		}
		if norm > 0 {
			total += acc / norm
		}
	}
	return total
}

// IccCurvePoints returns (theta, p) for plotting; c is 3PL asymptote in [0,0.35].
func IccCurvePoints(a, b, c float64) [][2]float64 {
	if c < 0 {
		c = 0
	}
	if c > 0.35 {
		c = 0.35
	}
	var out [][2]float64
	for t := thetaGridMin; t <= thetaGridMax+1e-9; t += 0.25 {
		p2 := Prob2pl(t, a, b)
		p := p2
		if c > 1e-6 {
			p = c + (1.0-c)*p2
		}
		if p < 0 {
			p = 0
		}
		if p > 1 {
			p = 1
		}
		out = append(out, [2]float64{t, p})
	}
	return out
}

// Calibrate2plMarginalGrid is coarse MML for (a,b) on dichotomous responses. Needs len≥10.
func Calibrate2plMarginalGrid(responses []byte) (a, b float64, ok bool) {
	if len(responses) < 10 {
		return 0, 0, false
	}
	var bestA, bestB, bestLL float64
	var have bool
	for a0 := 0.5; a0 <= 2.51; a0 += 0.25 {
		for b0 := -3.0; b0 <= 3.01; b0 += 0.25 {
			ll := MarginalLogLik2plItem(a0, b0, responses)
			if !have || ll > bestLL {
				have = true
				bestA, bestB, bestLL = a0, b0, ll
			}
		}
	}
	if !have {
		return 0, 0, false
	}
	a, b = bestA, bestB
	for i := 0; i < 12; i++ {
		base := MarginalLogLik2plItem(a, b, responses)
		da, db := 0.05, 0.05
		var stepA, stepB float64
		na := (a + da)
		if na > 3.0 {
			na = 3.0
		}
		if na < 0.3 {
			na = 0.3
		}
		if MarginalLogLik2plItem(na, b, responses) > base {
			stepA = da
		} else {
			na = (a - da)
			if na < 0.3 {
				na = 0.3
			}
			if na > 3.0 {
				na = 3.0
			}
			if MarginalLogLik2plItem(na, b, responses) > base {
				stepA = -da
			}
		}
		nb := b + db
		if nb > 3.5 {
			nb = 3.5
		}
		if nb < -3.5 {
			nb = -3.5
		}
		if MarginalLogLik2plItem(a, nb, responses) > base {
			stepB = db
		} else {
			nb = b - db
			if nb < -3.5 {
				nb = -3.5
			}
			if nb > 3.5 {
				nb = 3.5
			}
			if MarginalLogLik2plItem(a, nb, responses) > base {
				stepB = -db
			}
		}
		if stepA == 0 && stepB == 0 {
			break
		}
		a += stepA
		b += stepB
		if a < 0.3 {
			a = 0.3
		}
		if a > 3.0 {
			a = 3.0
		}
		if b < -3.5 {
			b = -3.5
		}
		if b > 3.5 {
			b = 3.5
		}
	}
	return a, b, true
}

// SortUniqueUUIDs sorts and deduplicates a UUID slice in place.
func SortUniqueUUIDs(in []uuid.UUID) []uuid.UUID {
	sort.Slice(in, func(i, j int) bool { return in[i].String() < in[j].String() })
	if len(in) == 0 {
		return in
	}
	j := 0
	for k := 1; k < len(in); k++ {
		if in[k] != in[j] {
			j++
			in[j] = in[k]
		}
	}
	return in[:j+1]
}
