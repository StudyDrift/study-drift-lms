// Package originalityreports maps course.originality_reports (see server/src/repos/originality_reports.rs).
package originalityreports

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FERPARow is one DSAR / FERPA export row.
type FERPARow struct {
	ReportID      uuid.UUID
	SubmissionID  uuid.UUID
	Provider      string
	Status        string
	SimilarityPct *float64
	AIProbability *float64
	UpdatedAt     time.Time
	CourseCode    string
	ModuleItemID  uuid.UUID
	SubmittedBy   uuid.UUID
}

// ListFerpaForUser is parity with `list_for_user_ferpa`.
func ListFerpaForUser(ctx context.Context, pool *pgxpool.Pool, submittedBy uuid.UUID) ([]FERPARow, error) {
	rows, err := pool.Query(ctx, `
SELECT r.id AS report_id, r.submission_id, r.provider, r.status,
	r.similarity_pct::float8, r.ai_probability::float8,
	r.updated_at, c.course_code, s.module_item_id, s.submitted_by
FROM course.originality_reports r
INNER JOIN course.module_assignment_submissions s ON s.id = r.submission_id
INNER JOIN course.courses c ON c.id = s.course_id
WHERE s.submitted_by = $1
ORDER BY r.updated_at ASC
`, submittedBy)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FERPARow
	for rows.Next() {
		var r FERPARow
		var sim, aip sql.NullFloat64
		if err := rows.Scan(
			&r.ReportID, &r.SubmissionID, &r.Provider, &r.Status,
			&sim, &aip, &r.UpdatedAt, &r.CourseCode, &r.ModuleItemID, &r.SubmittedBy,
		); err != nil {
			return nil, err
		}
		if sim.Valid {
			v := sim.Float64
			r.SimilarityPct = &v
		}
		if aip.Valid {
			v := aip.Float64
			r.AIProbability = &v
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
