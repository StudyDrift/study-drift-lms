package coursestructure

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/relativeschedule"
)

// AssignmentVisibleToStudent mirrors `course_structure::assignment_visible_to_student` (competency gating not yet ported).
func AssignmentVisibleToStudent(
	ctx context.Context, pool *pgxpool.Pool, courseID, assignmentID, userID uuid.UUID, now time.Time,
) (bool, error) {
	var (
		cPub, cArch, mPub, mArch            bool
		mVF, maAF, maAU                    *time.Time
		scheduleMode                        string
		crsAnchor                          *time.Time
		enrollCreatedAt                    *time.Time
	)
	err := pool.QueryRow(ctx, `
		SELECT
			page.published,
			page.archived,
			m.published,
			m.archived,
			m.visible_from,
			crs.schedule_mode,
			crs.relative_schedule_anchor_at,
			stu.created_at,
			ma.available_from,
			ma.available_until
		FROM course.course_structure_items page
		INNER JOIN course.course_structure_items m
			ON m.id = page.parent_id AND m.course_id = page.course_id AND m.kind = 'module'
		INNER JOIN course.courses crs ON crs.id = page.course_id
		LEFT JOIN course.course_enrollments stu
			ON stu.course_id = crs.id AND stu.user_id = $3 AND stu.role = 'student'
		LEFT JOIN course.module_assignments ma ON ma.structure_item_id = page.id
		WHERE page.id = $1 AND page.course_id = $2 AND page.kind = 'assignment'
	`, assignmentID, courseID, userID).Scan(
		&cPub, &cArch, &mPub, &mArch, &mVF, &scheduleMode, &crsAnchor, &enrollCreatedAt, &maAF, &maAU,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	utc := now.UTC()
	var effVF, effAF, effAU *time.Time
	if scheduleMode == "relative" {
		if crsAnchor != nil && enrollCreatedAt != nil {
			shift := &relativeschedule.Context{Anchor: *crsAnchor, EnrollmentStart: *enrollCreatedAt}
			effVF = shift.ShiftOpt(mVF)
			effAF = shift.ShiftOpt(maAF)
			effAU = shift.ShiftOpt(maAU)
		} else {
			effVF = mVF
			effAF = maAF
			effAU = maAU
		}
	} else {
		effVF = mVF
		effAF = maAF
		effAU = maAU
	}
	within := availabilityFromOK(effAF, utc) && availabilityUntilOK(effAU, utc)
	base := cPub && !cArch && mPub && !mArch && moduleVisibleFromOK(effVF, utc) && within
	if !base {
		return false, nil
	}
	// future: competency_gating::student_structure_item_competency_blocked_under_parent
	return true, nil
}

// moduleVisibleFromOK: t is None, or t <= now (module visible to learners).
func moduleVisibleFromOK(t *time.Time, now time.Time) bool {
	if t == nil {
		return true
	}
	return !t.After(now)
}

// availabilityFromOK: eff_af is None, or now >= t (open / visible window start).
func availabilityFromOK(t *time.Time, now time.Time) bool {
	if t == nil {
		return true
	}
	return !now.Before(*t)
}

// availabilityUntilOK: eff_au is None, or now <= t.
func availabilityUntilOK(t *time.Time, now time.Time) bool {
	if t == nil {
		return true
	}
	return !now.After(*t)
}
