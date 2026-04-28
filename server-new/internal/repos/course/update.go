package course

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
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
		RETURNING` + publicReturningColumns

	row := pool.QueryRow(ctx, q,
		title, description, published,
		startsAt, endsAt, visibleFrom, hiddenAt,
		scheduleMode, relativeEndAfter, relativeHiddenAfter, relativeScheduleAnchorAt,
		courseCode,
	)
	p, err := scanCoursePublicFromRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// publicReturningColumns is the RETURNING column list for public course rows (no table alias; matches coursePublicSelect order without "c.").
const publicReturningColumns = `
    id,
    course_code,
    title,
    description,
    hero_image_url,
    hero_image_object_position,
    starts_at,
    ends_at,
    visible_from,
    hidden_at,
    schedule_mode,
    relative_end_after,
    relative_hidden_after,
    relative_schedule_anchor_at,
    published,
    markdown_theme_preset,
    markdown_theme_custom,
    grading_scale,
    archived,
    notebook_enabled,
    feed_enabled,
    calendar_enabled,
    question_bank_enabled,
    lockdown_mode_enabled,
    standards_alignment_enabled,
    adaptive_paths_enabled,
    srs_enabled,
    diagnostic_assessments_enabled,
    hint_scaffolding_enabled,
    misconception_detection_enabled,
    course_type,
    created_at,
    updated_at,
    sbg_enabled,
    sbg_proficiency_scale_json,
    sbg_aggregation_rule
`
