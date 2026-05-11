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
	ID             uuid.UUID
	UserID         uuid.UUID
	DisplayName    *string
	Role           string
	RoleDisplay    *string
	SectionID      *uuid.UUID
	SectionCode    *string
	SectionName    *string
}

// ListRosterForCourse returns enrollments for a course code, ordered for UI.
func ListRosterForCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string) ([]RosterRow, error) {
	rows, err := pool.Query(ctx, `
SELECT
	ce.id,
	ce.user_id,
	u.display_name,
	ce.role,
	er.display_name,
	ce.section_id,
	cs.section_code,
	cs.name
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
LEFT JOIN course.enrollment_roles er ON er.role_key = ce.role
LEFT JOIN course.course_sections cs ON cs.id = ce.section_id
WHERE c.course_code = $1 AND ce.active
ORDER BY
	CASE ce.role
		WHEN 'owner' THEN 0
		WHEN 'teacher' THEN 0
		WHEN 'instructor' THEN 1
		WHEN 'ta' THEN 2
		WHEN 'designer' THEN 3
		WHEN 'observer' THEN 4
		WHEN 'auditor' THEN 5
		WHEN 'librarian' THEN 6
		WHEN 'student' THEN 7
		ELSE 8
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
		var secID sql.NullString
		var secCode, secName sql.NullString
		var roleDisplay sql.NullString
		if err := rows.Scan(&r.ID, &r.UserID, &display, &r.Role, &roleDisplay, &secID, &secCode, &secName); err != nil {
			return nil, err
		}
		if display.Valid {
			s := display.String
			if s != "" {
				r.DisplayName = &s
			}
		}
		if roleDisplay.Valid && roleDisplay.String != "" {
			s := roleDisplay.String
			r.RoleDisplay = &s
		}
		if secID.Valid {
			u, err := uuid.Parse(secID.String)
			if err == nil {
				r.SectionID = &u
			}
		}
		if secCode.Valid && secCode.String != "" {
			s := secCode.String
			r.SectionCode = &s
		}
		if secName.Valid && secName.String != "" {
			s := secName.String
			r.SectionName = &s
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
WHERE c.course_code = $1 AND ce.active
ORDER BY
	u.id,
	CASE ce.role
		WHEN 'owner' THEN 0
		WHEN 'teacher' THEN 0
		WHEN 'instructor' THEN 1
		WHEN 'ta' THEN 2
		WHEN 'designer' THEN 3
		WHEN 'observer' THEN 4
		WHEN 'auditor' THEN 5
		WHEN 'librarian' THEN 6
		WHEN 'student' THEN 7
		ELSE 8
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
