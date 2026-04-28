// Effective lockdown delivery (port of server/src/services/quiz_lockdown.rs).
package quizlockdown

import "strings"

// Standard lockdown mode tokens (see course + quiz settings).
const (
	LockdownStandard    = "standard"
	LockdownOneAtATime  = "one_at_a_time"
	LockdownKiosk       = "kiosk"
)

// QuizRowLockdown models the per-quiz field used by [EffectiveLockdownMode].
type QuizRowLockdown struct {
	LockdownMode string
}

// EffectiveLockdownMode picks the enforced mode from the course feature flag and quiz row.
func EffectiveLockdownMode(courseLockdownEnabled bool, row *QuizRowLockdown) string {
	if !courseLockdownEnabled {
		return LockdownStandard
	}
	if row == nil {
		return LockdownStandard
	}
	switch row.LockdownMode {
	case LockdownOneAtATime, LockdownKiosk:
		return row.LockdownMode
	default:
		return LockdownStandard
	}
}

// ServerEnforcesForwardLockdown is true when the API must keep strict delivery semantics.
func ServerEnforcesForwardLockdown(mode string) bool {
	return mode == LockdownOneAtATime || mode == LockdownKiosk
}

// HintsDisabled is true in any non-standard lockdown.
func HintsDisabled(mode string) bool {
	return mode != LockdownStandard
}

// BackNavigationAllowed is true in standard mode only.
func BackNavigationAllowed(mode string) bool {
	return mode == LockdownStandard
}

// ParseLockdownModeSetting returns a known mode token, or false when invalid.
func ParseLockdownModeSetting(raw string) (string, bool) {
	t := strings.TrimSpace(raw)
	switch t {
	case LockdownStandard:
		return LockdownStandard, true
	case LockdownOneAtATime:
		return LockdownOneAtATime, true
	case LockdownKiosk:
		return LockdownKiosk, true
	default:
		return "", false
	}
}
