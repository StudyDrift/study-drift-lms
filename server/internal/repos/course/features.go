package course

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PatchFeatures updates feature toggles on a course and returns the public row.
func PatchFeatures(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseCode string,
	notebookEnabled bool,
	feedEnabled bool,
	calendarEnabled bool,
	questionBankEnabled bool,
	lockdownModeEnabled bool,
	standardsAlignmentEnabled bool,
	adaptivePathsEnabled bool,
	srsEnabled bool,
	diagnosticAssessmentsEnabled bool,
	hintScaffoldingEnabled bool,
	misconceptionDetectionEnabled bool,
	discussionsEnabled bool,
	collabDocsEnabled bool,
	liveSessionsEnabled bool,
	groupSpacesEnabled bool,
	officeHoursEnabled bool,
	aiTutorEnabled bool,
) (*CoursePublic, error) {
	const q = `
		UPDATE course.courses
		SET
			notebook_enabled = $1,
			feed_enabled = $2,
			calendar_enabled = $3,
			question_bank_enabled = $4,
			lockdown_mode_enabled = $5,
			standards_alignment_enabled = $6,
			adaptive_paths_enabled = $7,
			srs_enabled = $8,
			diagnostic_assessments_enabled = $9,
			hint_scaffolding_enabled = $10,
			misconception_detection_enabled = $11,
			discussions_enabled = $12,
			collab_docs_enabled = $13,
			live_sessions_enabled = $14,
			group_spaces_enabled = $15,
			office_hours_enabled = $16,
			ai_tutor_enabled = $17,
			updated_at = NOW()
		WHERE course_code = $18
	`

	tag, err := pool.Exec(ctx, q,
		notebookEnabled, feedEnabled, calendarEnabled, questionBankEnabled,
		lockdownModeEnabled, standardsAlignmentEnabled, adaptivePathsEnabled, srsEnabled,
		diagnosticAssessmentsEnabled, hintScaffoldingEnabled, misconceptionDetectionEnabled,
		discussionsEnabled, collabDocsEnabled, liveSessionsEnabled, groupSpacesEnabled,
		officeHoursEnabled, aiTutorEnabled,
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

// SetSectionsEnabled toggles per-course sections (plan 5.4).
func SetSectionsEnabled(ctx context.Context, pool *pgxpool.Pool, courseCode string, enabled bool) (*CoursePublic, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE course.courses
		SET sections_enabled = $1, updated_at = NOW()
		WHERE course_code = $2
	`, enabled, courseCode)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}
	return GetPublicByCourseCode(ctx, pool, courseCode)
}
