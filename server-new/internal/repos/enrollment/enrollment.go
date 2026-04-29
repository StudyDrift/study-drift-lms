// Package enrollment maps server/src/repos/enrollment.rs (subset for /me/permissions).
package enrollment

import (
	"context"
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
	WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.active
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
SELECT EXISTS (SELECT 1 FROM course.course_enrollments WHERE course_id = $1 AND user_id = $2 AND active)
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
SELECT id
FROM course.course_enrollments
WHERE course_id = $1 AND user_id = $2 AND role = 'student' AND active
`, courseID, userID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &id, nil
}

// UserIsCourseStaff is true for teacher or instructor in the course.
func UserIsCourseStaff(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) (bool, error) {
	roles, err := UserRolesInCourse(ctx, pool, courseCode, userID)
	if err != nil {
		return false, err
	}
	for _, r := range roles {
		if r == "teacher" || r == "instructor" {
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
	WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.role = $3 AND ce.active
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
WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.active
ORDER BY
	CASE ce.role
		WHEN 'teacher' THEN 0
		WHEN 'instructor' THEN 1
		ELSE 2
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
WHERE ce.user_id = $1 AND ce.role IN ('teacher', 'instructor') AND ce.active
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