// ISO 8601 PnYnMnWnD duration validation (optional components in Y-M-W-D order; accepts P90D).

package relativeschedule

import (
	"fmt"
	"strings"
)

// ParseISO8601Duration validates: P, then zero or more of nY, nM, nW, nD in that order.
// A run of digits applies to the first unit letter in Y→M→W→D that immediately follows the digits
// (so P90D is 90 days, not a rejected year component).
func ParseISO8601Duration(s string) error {
	t := strings.TrimSpace(s)
	if t == "" {
		return fmt.Errorf("duration is empty")
	}
	t = strings.ToUpper(t)
	rest, ok := strings.CutPrefix(t, "P")
	if !ok {
		return fmt.Errorf("duration must start with P (ISO 8601)")
	}
	if rest == "" {
		return fmt.Errorf("duration has no components")
	}
	var d isoSum
	rem := rest
	for _, u := range []byte{'Y', 'M', 'W', 'D'} {
		if rem == "" {
			break
		}
		n, next, took := tryConsumeComponent(rem, u)
		if !took {
			continue
		}
		rem = next
		switch u {
		case 'Y':
			d.years = n
		case 'M':
			d.months = n
		case 'W':
			d.weeks = n
		case 'D':
			d.days = n
		}
	}
	if rem != "" {
		return fmt.Errorf("unsupported duration format (use PnYnMnWnD only)")
	}
	if d.isEmpty() {
		return fmt.Errorf("duration must include at least one component")
	}
	return nil
}

type isoSum struct{ years, months, weeks, days uint64 }

func (d isoSum) isEmpty() bool {
	return d.years == 0 && d.months == 0 && d.weeks == 0 && d.days == 0
}

// tryConsumeComponent if rem begins with <digits><u>, returns n and the remainder after the unit.
// If the digit run is not immediately followed by u, returns (0, rem, false) so a later
// unit can match the same digit run.
func tryConsumeComponent(rem string, u byte) (n uint64, after string, ok bool) {
	if rem == "" || rem[0] < '0' || rem[0] > '9' {
		return 0, rem, false
	}
	i := 0
	for i < len(rem) && rem[i] >= '0' && rem[i] <= '9' {
		i++
	}
	if i == 0 {
		return 0, rem, false
	}
	if i >= len(rem) {
		return 0, rem, false
	}
	if rem[i] != u {
		return 0, rem, false
	}
	for j := 0; j < i; j++ {
		n = n*10 + uint64(rem[j]-'0')
	}
	return n, rem[i+1:], true
}

// NormalizeRelativeDuration returns uppercased trimmed duration; empty becomes nil. Validates when non-empty.
func NormalizeRelativeDuration(s *string) (*string, error) {
	if s == nil {
		return nil, nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil, nil
	}
	if err := ParseISO8601Duration(t); err != nil {
		return nil, err
	}
	u := strings.ToUpper(t)
	return &u, nil
}
