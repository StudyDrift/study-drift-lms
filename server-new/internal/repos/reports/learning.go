// Package reports implements learning-activity aggregations (server/src/repos/reports.rs).
package reports

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	repmodels "github.com/lextures/lextures/server-new/internal/models/reports"
)

// LearningActivitySummary returns counts for user.user_audit in [from, to).
func LearningActivitySummary(
	ctx context.Context, pool *pgxpool.Pool, from, to time.Time,
) (repmodels.LearningActivitySummary, error) {
	var s repmodels.LearningActivitySummary
	err := pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::bigint,
			COUNT(DISTINCT user_id)::bigint,
			COUNT(DISTINCT course_id)::bigint
		FROM "user".user_audit
		WHERE occurred_at >= $1 AND occurred_at < $2
	`, from, to).Scan(&s.TotalEvents, &s.UniqueUsers, &s.UniqueCourses)
	if err != nil {
		return repmodels.LearningActivitySummary{}, err
	}
	return s, nil
}

// LearningActivityByDay returns per-day event_kind rollups in [from, to), UTC day buckets.
func LearningActivityByDay(
	ctx context.Context, pool *pgxpool.Pool, from, to time.Time,
) ([]repmodels.DayActivityBucket, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			(date_trunc('day', occurred_at AT TIME ZONE 'UTC'))::date,
			COUNT(*) FILTER (WHERE event_kind = 'course_visit')::bigint,
			COUNT(*) FILTER (WHERE event_kind = 'content_open')::bigint,
			COUNT(*) FILTER (WHERE event_kind = 'content_leave')::bigint
		FROM "user".user_audit
		WHERE occurred_at >= $1 AND occurred_at < $2
		GROUP BY 1
		ORDER BY 1 ASC
	`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanDayBuckets(rows)
}

func scanDayBuckets(rows pgx.Rows) ([]repmodels.DayActivityBucket, error) {
	out := make([]repmodels.DayActivityBucket, 0)
	for rows.Next() {
		var d pgtype.Date
		var courseVisit, contentOpen, contentLeave int64
		if err := rows.Scan(&d, &courseVisit, &contentOpen, &contentLeave); err != nil {
			return nil, err
		}
		day := ""
		if d.Valid {
			t := d.Time.UTC()
			day = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC).Format("2006-01-02")
		}
		out = append(out, repmodels.DayActivityBucket{
			Day:          day,
			CourseVisit:  courseVisit,
			ContentOpen:  contentOpen,
			ContentLeave: contentLeave,
		})
	}
	return out, rows.Err()
}

// LearningActivityByEventKind returns per-event_kind counts in [from, to), descending by count.
func LearningActivityByEventKind(
	ctx context.Context, pool *pgxpool.Pool, from, to time.Time,
) ([]repmodels.EventKindCount, error) {
	rows, err := pool.Query(ctx, `
		SELECT event_kind, COUNT(*)::bigint
		FROM "user".user_audit
		WHERE occurred_at >= $1 AND occurred_at < $2
		GROUP BY event_kind
		ORDER BY count DESC
	`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]repmodels.EventKindCount, 0)
	for rows.Next() {
		var e repmodels.EventKindCount
		if err := rows.Scan(&e.EventKind, &e.Count); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// LearningActivityTopCourses returns courses with the most user_audit events in the window.
func LearningActivityTopCourses(
	ctx context.Context, pool *pgxpool.Pool, from, to time.Time, limit int64,
) ([]repmodels.CourseActivityRow, error) {
	rows, err := pool.Query(ctx, `
		SELECT c.id, c.course_code, c.title, COUNT(*)::bigint
		FROM "user".user_audit ua
		INNER JOIN course.courses c ON c.id = ua.course_id
		WHERE ua.occurred_at >= $1 AND ua.occurred_at < $2
		GROUP BY c.id, c.course_code, c.title
		ORDER BY count DESC
		LIMIT $3
	`, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]repmodels.CourseActivityRow, 0)
	for rows.Next() {
		var id uuid.UUID
		var r repmodels.CourseActivityRow
		if err := rows.Scan(&id, &r.CourseCode, &r.Title, &r.EventCount); err != nil {
			return nil, err
		}
		r.CourseID = id.String()
		out = append(out, r)
	}
	return out, rows.Err()
}
