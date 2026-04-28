package moderatedgrading

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func CountFlaggedUnreconciled(ctx context.Context, pool *pgxpool.Pool, courseID, moduleItemID uuid.UUID, pointsWorth, thresholdPct int32) (int64, error) {
	if pool == nil {
		return 0, errors.New("db pool is nil")
	}
	pw := float64(pointsWorth)
	if pw < 1 {
		pw = 1
	}
	th := float64(thresholdPct)
	if th < 0 {
		th = 0
	}
	if th > 100 {
		th = 100
	}
	var n *int64
	err := pool.QueryRow(ctx, `
WITH agg AS (
	SELECT pg.submission_id,
		COUNT(*)::bigint AS n,
		MIN(pg.score) AS mn,
		MAX(pg.score) AS mx
	FROM course.provisional_grades pg
	INNER JOIN course.module_assignment_submissions s ON s.id = pg.submission_id
	WHERE s.course_id = $1 AND s.module_item_id = $2
	GROUP BY pg.submission_id
)
SELECT COUNT(*)::bigint
FROM course.module_assignment_submissions s
INNER JOIN agg a ON a.submission_id = s.id
LEFT JOIN course.course_grades g
	ON g.course_id = s.course_id
	AND g.module_item_id = s.module_item_id
	AND g.student_user_id = s.submitted_by
WHERE s.course_id = $1
	AND s.module_item_id = $2
	AND a.n >= 2
	AND (a.mx - a.mn) > ($3::double precision * $4::double precision / 100.0)
	AND g.reconciliation_source IS NULL
`, courseID, moduleItemID, pw, th).Scan(&n)
	if err != nil {
		return 0, err
	}
	if n == nil {
		return 0, nil
	}
	return *n, nil
}
