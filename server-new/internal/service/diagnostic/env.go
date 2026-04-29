package diagnostic

import (
	"os"
	"strings"
)

// GloballyEnabled mirrors DIAGNOSTIC_ASSESSMENTS_ENABLED (default off).
func GloballyEnabled() bool {
	v := strings.TrimSpace(os.Getenv("DIAGNOSTIC_ASSESSMENTS_ENABLED"))
	switch strings.ToLower(v) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// ActiveForCourse combines platform, course, and configuration flags.
func ActiveForCourse(globalOn, courseFlag, hasConfig bool) bool {
	return globalOn && courseFlag && hasConfig
}
