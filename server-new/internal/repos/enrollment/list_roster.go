// Package enrollment — course roster for LMS dashboard.
package enrollment

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RosterRow is one row for GET /api/v1/courses/{course}/enrollments.
type RosterRow struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	DisplayName *string
	Role        string
}

// ListRosterForCourse returns enrollments for a course code, ordered for UI.
func ListRosterForCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string) ([]RosterRow, error) {
	rows, err := pool.Query(ctx, `
SELECT
	ce.id,
	ce.user_id,
	u.display_name,
	ce.role
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
WHERE c.course_code = $1
ORDER BY
	CASE ce.role
		WHEN 'teacher' THEN 0
		WHEN 'instructor' THEN 1
		ELSE 2
	END,
	COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) ASC
`, courseCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RosterRow
	for rows.Next() {
		var r RosterRow
		var display sql.NullString
		if err := rows.Scan(&r.ID, &r.UserID, &display, &r.Role); err != nil {
			return nil, err
		}
		if display.Valid {
			s := display.String
			if s != "" {
				r.DisplayName = &s
			}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// FeedRosterRow is one person for GET /api/v1/courses/{course}/feed/roster.
type FeedRosterRow struct {
	UserID      uuid.UUID
	Email       string
	DisplayName *string
}

// ListFeedRosterForCourse returns distinct users enrolled in the course, for @mentions in the course feed.
func ListFeedRosterForCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string) ([]FeedRosterRow, error) {
	// One row per user when they have multiple enrollment roles in the same course.
	rows, err := pool.Query(ctx, `
SELECT DISTINCT ON (u.id)
	u.id,
	u.email,
	u.display_name
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
WHERE c.course_code = $1
ORDER BY
	u.id,
	CASE ce.role
		WHEN 'teacher' THEN 0
		WHEN 'instructor' THEN 1
		ELSE 2
	END
`, courseCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FeedRosterRow
	for rows.Next() {
		var r FeedRosterRow
		var display sql.NullString
		if err := rows.Scan(&r.UserID, &r.Email, &display); err != nil {
			return nil, err
		}
		if display.Valid {
			s := display.String
			if s != "" {
				r.DisplayName = &s
			}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
