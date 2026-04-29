// Package relativeschedule implements enrollment-relative date shifting (port of
// `server/src/services/relative_schedule.rs` `shift_opt` + load context for a user).
package relativeschedule

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Context pairs the course anchor and the student enrollment time for `shiftOpt`.
type Context struct {
	Anchor            time.Time
	EnrollmentStart   time.Time
}

// LoadForUser returns a non-nil context only when the course is in relative mode with an anchor
// and the user has a student enrollment (Rust `load_shift_context_for_user`).
func LoadForUser(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (*Context, error) {
	var mode string
	var anchor *time.Time
	err := pool.QueryRow(ctx, `
		SELECT schedule_mode, relative_schedule_anchor_at
		FROM course.courses
		WHERE id = $1
	`, courseID).Scan(&mode, &anchor)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if mode != "relative" || anchor == nil {
		return nil, nil
	}
	var enroll time.Time
	err = pool.QueryRow(ctx, `
		SELECT created_at
		FROM course.course_enrollments
		WHERE course_id = $1 AND user_id = $2 AND role = 'student' AND active
	`, courseID, userID).Scan(&enroll)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &Context{Anchor: *anchor, EnrollmentStart: enroll}, nil
}

// ShiftOpt re-anchors a stored timestamptz to the learner (Rust `shift_opt`).
func (c *Context) ShiftOpt(stored *time.Time) *time.Time {
	if c == nil || stored == nil {
		return stored
	}
	delta := stored.Sub(c.Anchor)
	out := c.EnrollmentStart.Add(delta)
	return &out
}
