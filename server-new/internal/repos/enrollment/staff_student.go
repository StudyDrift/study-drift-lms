package enrollment

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StaffSeesStudentInSharedCourse is true when staffUserID is teacher or instructor
// in a course where studentUserID is enrolled as student (parity with server/src/repos/enrollment.rs).
func StaffSeesStudentInSharedCourse(ctx context.Context, pool *pgxpool.Pool, staffUserID, studentUserID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.course_enrollments ce_staff
	INNER JOIN course.course_enrollments ce_stu ON ce_staff.course_id = ce_stu.course_id
	WHERE ce_staff.user_id = $1
	  AND ce_staff.role IN ('teacher', 'instructor')
	  AND ce_stu.user_id = $2
	  AND ce_stu.role = 'student'
	  AND ce_staff.active
	  AND ce_stu.active
)`, staffUserID, studentUserID).Scan(&ok)
	return ok, err
}
