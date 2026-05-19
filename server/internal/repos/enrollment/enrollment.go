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

// GetStudentEnrollmentID returns the student enrollment row id for the user's student-equivalent enrollment.
// Uses the enrollment_roles catalog (is_student_equivalent = true) rather than a hard-coded role string.
func GetStudentEnrollmentID(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (*uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
SELECT ce.id
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
INNER JOIN course.enrollment_roles er ON er.role_key = ce.role AND er.is_student_equivalent = true
WHERE ce.course_id = $1 AND ce.user_id = $2 AND ce.active AND c.org_id = u.org_id
LIMIT 1
`, courseID, userID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &id, nil
}

// GetStudentSectionID returns ce.section_id for the viewer's active student-equivalent enrollment.
// Uses the enrollment_roles catalog (is_student_equivalent = true) rather than a hard-coded role string.
func GetStudentSectionID(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (*uuid.UUID, error) {
	var sid sql.NullString
	err := pool.QueryRow(ctx, `
SELECT ce.section_id::text
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
INNER JOIN course.enrollment_roles er ON er.role_key = ce.role AND er.is_student_equivalent = true
WHERE ce.course_id = $1 AND ce.user_id = $2 AND ce.active AND c.org_id = u.org_id
LIMIT 1
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

// UserIsCourseStaff is true when the user has any active enrollment whose role has is_staff = true.
// Uses the enrollment_roles catalog rather than hard-coded role strings.
func UserIsCourseStaff(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.course_enrollments ce
	INNER JOIN course.courses c ON c.id = ce.course_id
	INNER JOIN "user".users u ON u.id = ce.user_id
	INNER JOIN course.enrollment_roles er ON er.role_key = ce.role AND er.is_staff = true
	WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.active AND c.org_id = u.org_id
)
`, courseCode, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// UserIsCourseStaffByID is like UserIsCourseStaff but accepts a course UUID primary key.
func UserIsCourseStaffByID(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.course_enrollments ce
	INNER JOIN course.enrollment_roles er ON er.role_key = ce.role AND er.is_staff = true
	WHERE ce.course_id = $1 AND ce.user_id = $2 AND ce.active = true
)
`, courseID, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// UserHasEnrollmentRole checks a single role string (e.g. "teacher").
// For student-equivalent checks prefer UserHasStudentEquivalentEnrollment.
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

// UserHasStudentEquivalentEnrollment returns true when the user holds any active enrollment
// whose role has is_student_equivalent = true in the catalog.
func UserHasStudentEquivalentEnrollment(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.course_enrollments ce
	INNER JOIN course.courses c ON c.id = ce.course_id
	INNER JOIN "user".users u ON u.id = ce.user_id
	INNER JOIN course.enrollment_roles er ON er.role_key = ce.role AND er.is_student_equivalent = true
	WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.active AND c.org_id = u.org_id
)
`, courseCode, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// UserRolesInCourse returns one row per enrollment role, ordered by sort_order from the catalog.
func UserRolesInCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) ([]string, error) {
	rows, err := pool.Query(ctx, `
SELECT ce.role
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
LEFT JOIN course.enrollment_roles er ON er.role_key = ce.role
WHERE c.course_code = $1 AND ce.user_id = $2 AND ce.active AND c.org_id = u.org_id
ORDER BY
	COALESCE(er.sort_order, 999) ASC,
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

// ListCourseCodesWhereUserIsStaff returns course codes where the user has a staff-equivalent enrollment.
// Uses the enrollment_roles catalog (is_staff = true) rather than hard-coded role strings.
func ListCourseCodesWhereUserIsStaff(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]string, error) {
	rows, err := pool.Query(ctx, `
SELECT c.course_code
FROM course.course_enrollments ce
INNER JOIN course.courses c ON c.id = ce.course_id
INNER JOIN "user".users u ON u.id = ce.user_id
INNER JOIN course.enrollment_roles er ON er.role_key = ce.role AND er.is_staff = true
WHERE ce.user_id = $1 AND ce.active AND c.org_id = u.org_id
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
