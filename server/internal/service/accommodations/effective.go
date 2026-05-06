// Package accommodations is application logic for student accommodation resolution (server/src/services/accommodations.rs subset).
package accommodations

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/repos/studentaccommodations"
)

// Effective holds operational settings for quiz / UI (mirrors Rust EffectiveAccommodations).
type Effective struct {
	TimeMultiplier     float64
	ExtraAttempts      int32
	HintsAlwaysEnabled bool
	ReducedDistraction bool
}

// FromRow builds effective state from a DB row.
func FromRow(r *studentaccommodations.Row) Effective {
	if r == nil {
		return Effective{TimeMultiplier: 1, ExtraAttempts: 0}
	}
	tm := r.TimeMultiplier
	if tm < 1 {
		tm = 1
	}
	ea := r.ExtraAttempts
	if ea < 0 {
		ea = 0
	}
	return Effective{
		TimeMultiplier:     tm,
		ExtraAttempts:      ea,
		HintsAlwaysEnabled: r.HintsAlwaysEnabled,
		ReducedDistraction: r.ReducedDistraction,
	}
}

// HasOperationalSettings is true if any non-default effect is in force.
func (e Effective) HasOperationalSettings() bool {
	return e.TimeMultiplier > 1.000001 ||
		e.ExtraAttempts > 0 ||
		e.HintsAlwaysEnabled ||
		e.ReducedDistraction
}

// ResolveEffectiveForCourse prefers a course-specific row, else global, else zero defaults.
func ResolveEffectiveForCourse(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID) (Effective, error) {
	if r, err := studentaccommodations.FindActiveForCourse(ctx, pool, userID, courseID); err != nil {
		return Effective{}, err
	} else if r != nil {
		return FromRow(r), nil
	}
	if r, err := studentaccommodations.FindActiveGlobal(ctx, pool, userID); err != nil {
		return Effective{}, err
	} else if r != nil {
		return FromRow(r), nil
	}
	return Effective{TimeMultiplier: 1, ExtraAttempts: 0}, nil
}

// ResolveEffectiveOrDefault never fails the caller: logs DB errors and returns zero defaults.
func ResolveEffectiveOrDefault(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID) Effective {
	eff, err := ResolveEffectiveForCourse(ctx, pool, userID, courseID)
	if err != nil {
		prefix := userID.String()
		if len(prefix) > 8 {
			prefix = prefix[:8]
		}
		log.Printf("accommodation lookup failed; using defaults (user_id_prefix=%s err=%v)", prefix, err)
		return Effective{TimeMultiplier: 1, ExtraAttempts: 0}
	}
	return eff
}

// InstructorFlagLabels lists short labels for the enrollment summary (Rust instructor_flag_labels).
func InstructorFlagLabels(e Effective) []string {
	var v []string
	if e.TimeMultiplier > 1.000001 {
		v = append(v, "extended_time")
	}
	if e.ExtraAttempts > 0 {
		v = append(v, "extra_attempts")
	}
	if e.ReducedDistraction {
		v = append(v, "reduced_distraction")
	}
	if e.HintsAlwaysEnabled {
		v = append(v, "always_allow_hints")
	}
	return v
}

// RowActiveOnDate applies effective range rules in the enrolling user's local calendar date in UTC (parity with Utc::now().date_naive()).
func RowActiveOnDate(effectiveFrom, effectiveUntil sql.NullTime, day time.Time) bool {
	day0 := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	if effectiveFrom.Valid {
		f := time.Date(
			effectiveFrom.Time.Year(), effectiveFrom.Time.Month(), effectiveFrom.Time.Day(),
			0, 0, 0, 0, time.UTC,
		)
		if day0.Before(f) {
			return false
		}
	}
	if effectiveUntil.Valid {
		u := time.Date(
			effectiveUntil.Time.Year(), effectiveUntil.Time.Month(), effectiveUntil.Time.Day(),
			0, 0, 0, 0, time.UTC,
		)
		if day0.After(u) {
			return false
		}
	}
	return true
}
