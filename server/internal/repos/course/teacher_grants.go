package course

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SeedTeacherCourseGrants inserts course.user_course_grants for the primary staff role matrix
// (teacher / instructor / owner). Keep this list aligned with courseroles.RoleMatrixPermissions
// for those roles.
func SeedTeacherCourseGrants(ctx context.Context, tx pgx.Tx, userID, courseID uuid.UUID, courseCode string) error {
	prefix := "course:" + courseCode + ":"
	perms := []string{
		prefix + "item:create",
		prefix + "items:create",
		prefix + "enrollments:read",
		prefix + "enrollments:update",
		prefix + "gradebook:view",
	}
	for _, perm := range perms {
		if _, err := tx.Exec(ctx, `
INSERT INTO course.user_course_grants (user_id, course_id, permission_string)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, course_id, permission_string) DO NOTHING
`, userID, courseID, perm); err != nil {
			return err
		}
	}
	return nil
}
