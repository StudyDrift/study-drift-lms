// Provisional-score spread for moderator workflows (port of server/src/services/moderated_grading.rs).
package moderatedgrading

// ProvisionalScoresExceedThreshold is true when max−min exceeds threshold_pct of the point scale
// (defaulting pointsWorth to 100, minimum 1).
func ProvisionalScoresExceedThreshold(minScore, maxScore float64, pointsWorth *int32, thresholdPct int32) bool {
	pw := 100.0
	if pointsWorth != nil && *pointsWorth > 0 {
		pw = float64(*pointsWorth)
	}
	if pw < 1 {
		pw = 1
	}
	th := float64(thresholdPct)
	if th < 0 {
		th = 0
	}
	if th > 100 {
		th = 100
	}
	return maxScore-minScore > (pw*th/100.0)+1e-9
}
