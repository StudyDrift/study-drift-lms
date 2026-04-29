package enrollment

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/models/search"
)

// ListPeopleForEnrolledCourses lists enrollments in all non-archived courses the requester is enrolled in
// (capped at 2000, same as Rust), with human-readable role labels.
func ListPeopleForEnrolledCourses(ctx context.Context, pool *pgxpool.Pool, requesterUserID uuid.UUID) ([]search.PersonItem, error) {
	rows, err := pool.Query(ctx, `
SELECT
    u.id AS user_id,
    u.email,
    u.display_name,
    COALESCE(er.display_name, initcap(ce.role)) AS role_label,
    c.course_code,
    c.title AS course_title
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
LEFT JOIN course.enrollment_roles er ON er.role_key = ce.role
WHERE c.archived = false
  AND c.id IN (
    SELECT ce2.course_id
    FROM course.course_enrollments ce2
    WHERE ce2.user_id = $1 AND ce2.active
  )
  AND ce.active
ORDER BY
    c.title ASC,
    COALESCE(er.sort_order, 999),
    COALESCE(NULLIF(TRIM(u.display_name), ''), u.email) ASC
LIMIT 2000
`, requesterUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []search.PersonItem
	for rows.Next() {
		var it search.PersonItem
		var display sql.NullString
		var roleLabel string
		if err := rows.Scan(&it.UserID, &it.Email, &display, &roleLabel, &it.CourseCode, &it.CourseTitle); err != nil {
			return nil, err
		}
		if display.Valid {
			s := display.String
			it.DisplayName = &s
		}
		it.Role = roleLabel
		out = append(out, it)
	}
	return out, rows.Err()
}
