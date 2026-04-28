package enrollmentgroups

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server-new/internal/models/enrollmentgroup"
)

func EnrollmentGroupsEnabledForCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string) (bool, error) {
	var enabled bool
	err := pool.QueryRow(ctx, `
SELECT c.enrollment_groups_enabled
FROM course.courses c
WHERE c.course_code = $1
`, courseCode).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return enabled, err
}

func EnableEnrollmentGroups(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
UPDATE course.courses
SET enrollment_groups_enabled = true, updated_at = NOW()
WHERE id = $1
`, courseID); err != nil {
		return err
	}
	var setCount int64
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM course.enrollment_group_sets WHERE course_id = $1`, courseID).Scan(&setCount); err != nil {
		return err
	}
	if setCount == 0 {
		var sortOrder int32
		if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM course.enrollment_group_sets WHERE course_id = $1`, courseID).Scan(&sortOrder); err != nil {
			return err
		}
		var defaultSetID uuid.UUID
		if err := tx.QueryRow(ctx, `
INSERT INTO course.enrollment_group_sets (course_id, name, sort_order)
VALUES ($1, 'Default', $2)
RETURNING id
`, courseID, sortOrder).Scan(&defaultSetID); err != nil {
			return err
		}
		var groupSort int32
		if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM course.enrollment_groups WHERE group_set_id = $1`, defaultSetID).Scan(&groupSort); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO course.enrollment_groups (group_set_id, name, sort_order) VALUES ($1, 'Group 1', $2)`, defaultSetID, groupSort); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func ListMembershipsForCourseCode(ctx context.Context, pool *pgxpool.Pool, courseCode string) (map[uuid.UUID][]enrollmentgroup.EnrollmentGroupMembershipPublic, error) {
	rows, err := pool.Query(ctx, `
SELECT m.enrollment_id, m.group_set_id, m.group_id
FROM course.enrollment_group_memberships m
INNER JOIN course.course_enrollments ce ON ce.id = m.enrollment_id
INNER JOIN course.courses c ON c.id = ce.course_id
WHERE c.course_code = $1 AND ce.role = 'student'
`, courseCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID][]enrollmentgroup.EnrollmentGroupMembershipPublic{}
	for rows.Next() {
		var eid uuid.UUID
		var membership enrollmentgroup.EnrollmentGroupMembershipPublic
		if err := rows.Scan(&eid, &membership.GroupSetID, &membership.GroupID); err != nil {
			return nil, err
		}
		out[eid] = append(out[eid], membership)
	}
	return out, rows.Err()
}

func GroupSetBelongsToCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string, setID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1
	FROM course.enrollment_group_sets s
	INNER JOIN course.courses c ON c.id = s.course_id
	WHERE s.id = $1 AND c.course_code = $2
)
`, setID, courseCode).Scan(&ok)
	return ok, err
}
