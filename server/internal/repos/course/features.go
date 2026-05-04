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
			updated_at = NOW()
		WHERE course_code = $12
	`

	tag, err := pool.Exec(ctx, q,
		notebookEnabled, feedEnabled, calendarEnabled, questionBankEnabled,
		lockdownModeEnabled, standardsAlignmentEnabled, adaptivePathsEnabled, srsEnabled,
		diagnosticAssessmentsEnabled, hintScaffoldingEnabled, misconceptionDetectionEnabled,
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

