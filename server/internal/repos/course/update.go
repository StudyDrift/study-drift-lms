package course

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// UpdateCourse sets general course fields (parity with server `update_course` / `update_handler`).
func UpdateCourse(
	ctx context.Context, pool *pgxpool.Pool, courseCode string,
	title, description string, published bool,
	startsAt, endsAt, visibleFrom, hiddenAt *time.Time,
	scheduleMode string,
	relativeEndAfter, relativeHiddenAfter *string,
	relativeScheduleAnchorAt *time.Time,
) (*CoursePublic, error) {
	const q = `
		UPDATE course.courses
		SET
			title = $1,
			description = $2,
			published = $3,
			starts_at = $4,
			ends_at = $5,
			visible_from = $6,
			hidden_at = $7,
			schedule_mode = $8,
			relative_end_after = $9,
			relative_hidden_after = $10,
			relative_schedule_anchor_at = $11,
			updated_at = NOW()
		WHERE course_code = $12
	`
	tag, err := pool.Exec(ctx, q,
		title, description, published,
		startsAt, endsAt, visibleFrom, hiddenAt,
		scheduleMode, relativeEndAfter, relativeHiddenAfter, relativeScheduleAnchorAt,
		courseCode,
	)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}
	return GetPublicByCourseCode(ctx, pool, courseCode)
}
