// Package enrollment maps server/src/repos/enrollment.rs (subset for /me/permissions).
package enrollment

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UserHasAccess is true when the user has any enrollment row for the course code.
func UserHasAccess(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.course_enrollments ce
	INNER JOIN course.courses c ON c.id = ce.course_id
	INNER JOIN "user".users u ON u.id = ce.user_id
	WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.active AND c.org_id = u.org_id
)
`, courseCode, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// UserHasAccessByCourseID is true when the user has any enrollment for the course primary key.
func UserHasAccessByCourseID(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.course_enrollments ce
	INNER JOIN course.courses c ON c.id = ce.course_id
	INNER JOIN "user".users u ON u.id = ce.user_id
	WHERE ce.course_id = $1 AND ce.user_id = $2 AND ce.active AND c.org_id = u.org_id
)
`, courseID, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// GetStudentEnrollmentID returns the student enrollment row id when the user is enrolled as student, else nil.
func GetStudentEnrollmentID(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (*uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT ce.id
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
WHERE ce.course_id = $1 AND ce.user_id = $2 AND ce.role = 'student' AND ce.active AND c.org_id = u.org_id
`, courseID, userID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &id, nil
}

// GetStudentSectionID returns ce.section_id for the viewer's active student enrollment in the course, if any.
func GetStudentSectionID(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (*uuid.UUID, error) {
	var sid sql.NullString
	err := pool.QueryRow(ctx, `
SELECT ce.section_id::text
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
WHERE ce.course_id = $1 AND ce.user_id = $2 AND ce.role = 'student' AND ce.active AND c.org_id = u.org_id
`, courseID, userID).Scan(&sid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if !sid.Valid || sid.String == "" {
		return nil, nil
	}
	u, err := uuid.Parse(sid.String)
	if err != nil {
		return nil, nil
	}
	return &u, nil
}

// UserIsCourseStaff is true for teacher or instructor in the course.
func UserIsCourseStaff(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) (bool, error) {
	roles, err := UserRolesInCourse(ctx, pool, courseCode, userID)
	if err != nil {
		return false, err
	}
	for _, r := range roles {
		if r == "teacher" || r == "instructor" || r == "owner" {
			return true, nil
		}
	}
	return false, nil
}

// UserHasEnrollmentRole checks a single role string (e.g. "student").
func UserHasEnrollmentRole(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID, role string) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.course_enrollments ce
	INNER JOIN course.courses c ON c.id = ce.course_id
	INNER JOIN "user".users u ON u.id = ce.user_id
	WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.role = $3 AND ce.active AND c.org_id = u.org_id
)
`, courseCode, userID, role).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// UserRolesInCourse returns one row per enrollment role (teacher/instructor first), matching Rust `user_roles_in_course`.
func UserRolesInCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) ([]string, error) {
	rows, err := pool.Query(ctx, `
SELECT ce.role
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.active AND c.org_id = u.org_id
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
	ce.role ASC
`, courseCode, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			return nil, err
		}
		out = append(out, role)
	}
	return out, rows.Err()
}

// ListCourseCodesWhereUserIsStaff returns course codes where the user is teacher or instructor.
func ListCourseCodesWhereUserIsStaff(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]string, error) {
	rows, err := pool.Query(ctx, `
SELECT c.course_code
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
WHERE ce.user_id = $1 AND ce.role IN ('teacher', 'instructor', 'owner') AND ce.active AND c.org_id = u.org_id
ORDER BY c.course_code ASC
`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		out = append(out, code)
	}
	return out, rows.Err()
}
