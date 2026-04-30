package coursestructure

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/relativeschedule"
)

// SurveyVisibleToStudent mirrors `course_structure::survey_visible_to_student` (competency gating not yet ported).
func SurveyVisibleToStudent(
	ctx context.Context, pool *pgxpool.Pool, courseID, surveyID, userID uuid.UUID, now time.Time,
) (bool, error) {
	var (
		cPub, cArch, mPub, mArch  bool
		mVF                       *time.Time
		scheduleMode              string
		crsAnchor, enrollCreatedAt *time.Time
		opensAt, closesAt         *time.Time
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
			s.opens_at,
			s.closes_at
		FROM course.course_structure_items page
		INNER JOIN course.course_structure_items m
			ON m.id = page.parent_id AND m.course_id = page.course_id AND m.kind = 'module'
		INNER JOIN course.courses crs ON crs.id = page.course_id
		LEFT JOIN course.course_enrollments stu
			ON stu.course_id = crs.id AND stu.user_id = $3 AND stu.role = 'student' AND stu.active
		LEFT JOIN course.module_surveys s ON s.structure_item_id = page.id
		WHERE page.id = $1 AND page.course_id = $2 AND page.kind = 'survey'
	`, surveyID, courseID, userID).Scan(
		&cPub, &cArch, &mPub, &mArch, &mVF, &scheduleMode, &crsAnchor, &enrollCreatedAt, &opensAt, &closesAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	utc := now.UTC()
	var effVF, effOpen, effClose *time.Time
	if scheduleMode == "relative" {
		if crsAnchor != nil && enrollCreatedAt != nil {
			shift := &relativeschedule.Context{Anchor: *crsAnchor, EnrollmentStart: *enrollCreatedAt}
			effVF = shift.ShiftOpt(mVF)
			effOpen = shift.ShiftOpt(opensAt)
			effClose = shift.ShiftOpt(closesAt)
		} else {
			effVF = mVF
			effOpen = opensAt
			effClose = closesAt
		}
	} else {
		effVF = mVF
		effOpen = opensAt
		effClose = closesAt
	}
	within := availabilityFromOK(effOpen, utc) && availabilityUntilOK(effClose, utc)
	base := cPub && !cArch && mPub && !mArch && moduleVisibleFromOK(effVF, utc) && within
	if !base {
		return false, nil
	}
	// future: competency_gating::student_structure_item_competency_blocked_under_parent
	return true, nil
}
