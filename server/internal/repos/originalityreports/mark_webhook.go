package originalityreports

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MarkDoneByProviderReport updates external reports matched by provider_report_id (webhook completion).
// Returns (report_id, submission_id) pairs updated.
func MarkDoneByProviderReport(
	ctx context.Context, pool *pgxpool.Pool,
	provider, providerReportID string,
	similarityPct *float64,
	reportURL, reportToken *string,
) ([]struct {
	ReportID     uuid.UUID
	SubmissionID uuid.UUID
}, error) {
	rows, err := pool.Query(ctx, `
UPDATE course.originality_reports
SET status = 'done',
	similarity_pct = COALESCE($2::numeric, similarity_pct),
	report_url = COALESCE($3, report_url),
	report_token = COALESCE($4, report_token),
	error_message = NULL,
	updated_at = NOW()
WHERE provider = $1 AND provider_report_id = $5
RETURNING id, submission_id
`, provider, similarityPct, reportURL, reportToken, providerReportID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []struct {
		ReportID     uuid.UUID
		SubmissionID uuid.UUID
	}
	for rows.Next() {
		var r struct {
			ReportID     uuid.UUID
			SubmissionID uuid.UUID
		}
		if err := rows.Scan(&r.ReportID, &r.SubmissionID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
