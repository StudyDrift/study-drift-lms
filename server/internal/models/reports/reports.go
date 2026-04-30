// Package reports holds JSON DTOs for /api/v1/reports (server/src/models/reports.rs).
package reports

import "time"

// LearningActivityReport aggregates user_audit rows for a date range.
type LearningActivityReport struct {
	Range         DateRange                 `json:"range"`
	Summary       LearningActivitySummary  `json:"summary"`
	ByDay         []DayActivityBucket      `json:"byDay"`
	ByEventKind   []EventKindCount         `json:"byEventKind"`
	TopCourses    []CourseActivityRow     `json:"topCourses"`
}

// DateRange is the resolved query window (RFC 3339 timestamps, UTC).
type DateRange struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// LearningActivitySummary is high-level counts over the range.
type LearningActivitySummary struct {
	TotalEvents   int64 `json:"totalEvents"`
	UniqueUsers  int64 `json:"uniqueUsers"`
	UniqueCourses int64 `json:"uniqueCourses"`
}

// DayActivityBucket is one calendar day in UTC, keyed as YYYY-MM-DD (NaiveDate parity with Rust).
type DayActivityBucket struct {
	Day          string `json:"day"`
	CourseVisit  int64  `json:"courseVisit"`
	ContentOpen  int64  `json:"contentOpen"`
	ContentLeave int64  `json:"contentLeave"`
}

// EventKindCount counts events by user_audit.event_kind.
type EventKindCount struct {
	EventKind string `json:"eventKind"`
	Count     int64  `json:"count"`
}

// CourseActivityRow is a top course by event volume.
type CourseActivityRow struct {
	CourseID   string `json:"courseId"`
	CourseCode string `json:"courseCode"`
	Title      string `json:"title"`
	EventCount int64  `json:"eventCount"`
}
