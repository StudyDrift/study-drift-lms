package httpserver

import (
	"fmt"
	"net/url"
	"time"
)

const (
	learningActivityTopCoursesLimit = int64(15)
	learningActivityMaxRangeDays    = int64(366)
)

// parseLearningActivityTimeRange mirrors server/src/routes/reports.rs resolve_range (defaults, bounds, error text).
func parseLearningActivityTimeRange(q url.Values, now time.Time) (from, to time.Time, err error) {
	to = now
	if s := q.Get("to"); s != "" {
		t, perr := time.Parse(time.RFC3339, s)
		if perr != nil {
			return time.Time{}, time.Time{}, errLearningActivityTimeRangeInvalid()
		}
		to = t.UTC()
	}
	// Default matches Rust: to - chrono::Duration::days(30) (30×24h, not calendar).
	from = to.Add(-30 * 24 * time.Hour)
	if s := q.Get("from"); s != "" {
		f, perr := time.Parse(time.RFC3339, s)
		if perr != nil {
			return time.Time{}, time.Time{}, errLearningActivityTimeRangeInvalid()
		}
		from = f.UTC()
	}
	if !from.Before(to) {
		return time.Time{}, time.Time{}, fmt.Errorf("`from` must be before `to`.")
	}
	// Match Rust: (to - from).num_days() > MAX_RANGE_DAYS
	sec := to.Unix() - from.Unix()
	days := sec / 86400
	if days > int64(learningActivityMaxRangeDays) {
		return time.Time{}, time.Time{}, fmt.Errorf("Date range cannot exceed %d days.", learningActivityMaxRangeDays)
	}
	return from, to, nil
}

func errLearningActivityTimeRangeInvalid() error {
	return fmt.Errorf("Invalid `from` or `to`: use RFC 3339 (e.g. 2026-04-01T00:00:00Z).")
}
