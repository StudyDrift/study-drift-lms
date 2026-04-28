package course

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/models/search"
)

// ListForSearchIndex returns non-archived courses the user is enrolled in, ordered like the catalog.
func ListForSearchIndex(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]search.CourseItem, error) {
	rows, err := pool.Query(ctx, `
SELECT
    c.course_code,
    c.title,
    c.notebook_enabled,
    c.feed_enabled,
    c.calendar_enabled,
    c.question_bank_enabled,
    c.lockdown_mode_enabled,
    c.standards_alignment_enabled,
    c.adaptive_paths_enabled,
    c.srs_enabled,
    c.diagnostic_assessments_enabled,
    c.hint_scaffolding_enabled,
    c.misconception_detection_enabled
FROM course.courses c
LEFT JOIN course.user_course_catalog_order o ON o.user_id = $1 AND o.course_id = c.id
WHERE c.id IN (SELECT e.course_id FROM course.course_enrollments e WHERE e.user_id = $1)
  AND c.archived = false
ORDER BY o.sort_order NULLS LAST, c.title ASC
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []search.CourseItem
	for rows.Next() {
		var it search.CourseItem
		if err := rows.Scan(
			&it.CourseCode,
			&it.Title,
			&it.NotebookEnabled,
			&it.FeedEnabled,
			&it.CalendarEnabled,
			&it.QuestionBankEnabled,
			&it.LockdownModeEnabled,
			&it.StandardsAlignmentEnabled,
			&it.AdaptivePathsEnabled,
			&it.SRSEnabled,
			&it.DiagnosticAssessmentsEnabled,
			&it.HintScaffoldingEnabled,
			&it.MisconceptionDetectionEnabled,
		); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}
