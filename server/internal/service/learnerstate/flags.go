// Package learnerstate feature flags (port of the env helpers at the top of server/src/services/learner_state.rs).
package learnerstate

import (
	"os"
	"strconv"
	"strings"
)

// LearnerModelEnabled reflects ADAPTIVE_LEARNER_MODEL_ENABLED (default false).
func LearnerModelEnabled() bool {
	v, ok := os.LookupEnv("ADAPTIVE_LEARNER_MODEL_ENABLED")
	if !ok {
		return false
	}
	s := strings.TrimSpace(strings.ToLower(v))
	return s == "1" || s == "true" || s == "yes" || s == "on"
}

// LearnerEMAAlpha returns LEARNER_MODEL_EMA_ALPHA (default 0.3, in (0,1]).
func LearnerEMAAlpha() float64 {
	v := strings.TrimSpace(os.Getenv("LEARNER_MODEL_EMA_ALPHA"))
	if v == "" {
		return 0.3
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f <= 0 || f > 1 {
		return 0.3
	}
	return f
}
