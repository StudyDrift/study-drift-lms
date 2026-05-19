// Package groupspaces provides repository functions for the Group Spaces feature (plan 6.6).
// Groups use course.enrollment_groups and share feed channels (course.feed_channels with a
// non-null group_id). Channels with group_id IS NULL remain course-level.
package groupspaces

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GroupPublic is the public JSON representation of an enrollment group.
type GroupPublic struct {
	ID          uuid.UUID `json:"id"`
	GroupSetID  uuid.UUID `json:"groupSetId"`
	Name        string    `json:"name"`
	SortOrder   int       `json:"sortOrder"`
	CreatedAt   time.Time `json:"createdAt"`
	MemberCount int64     `json:"memberCount"`
}

// IsGroupMember returns true if the user is enrolled in the given group within the course.
func IsGroupMember(ctx context.Context, pool *pgxpool.Pool, courseCode string, groupID, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM course.enrollment_group_memberships m
			JOIN course.enrollment_groups g ON g.id = m.group_id
			JOIN course.enrollment_group_sets s ON s.id = g.group_set_id
			JOIN course.courses c ON c.id = s.course_id
			JOIN course.course_enrollments e ON e.id = m.enrollment_id
			WHERE c.course_code = $1
			  AND m.group_id = $2
			  AND e.user_id = $3
			  AND e.active = true
		)
	`, courseCode, groupID, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// IsInstructor returns true if the user has instructor/teacher role in the course.
func IsInstructor(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) (bool, error) {
	var ok bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM course.course_enrollments e
			JOIN course.courses c ON c.id = e.course_id
			WHERE c.course_code = $1
			  AND e.user_id = $2
			  AND e.active = true
			  AND e.course_role IN ('teacher', 'instructor')
		)
	`, courseCode, userID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// ListGroupsForCourse returns all groups for a course, with member counts.
func ListGroupsForCourse(ctx context.Context, pool *pgxpool.Pool, courseCode string) ([]GroupPublic, error) {
	rows, err := pool.Query(ctx, `
		SELECT g.id, g.group_set_id, g.name, g.sort_order, g.created_at,
		       COUNT(m.enrollment_id) AS member_count
		FROM course.enrollment_groups g
		JOIN course.enrollment_group_sets s ON s.id = g.group_set_id
		JOIN course.courses c ON c.id = s.course_id
		LEFT JOIN course.enrollment_group_memberships m ON m.group_id = g.id
		WHERE c.course_code = $1
		GROUP BY g.id, g.group_set_id, g.name, g.sort_order, g.created_at
		ORDER BY s.sort_order ASC, g.sort_order ASC, g.name ASC
	`, courseCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGroups(rows)
}

// ListGroupsForUser returns groups the user belongs to within the course.
func ListGroupsForUser(ctx context.Context, pool *pgxpool.Pool, courseCode string, userID uuid.UUID) ([]GroupPublic, error) {
	rows, err := pool.Query(ctx, `
		SELECT g.id, g.group_set_id, g.name, g.sort_order, g.created_at,
		       COUNT(m2.enrollment_id) AS member_count
		FROM course.enrollment_group_memberships m
		JOIN course.enrollment_groups g ON g.id = m.group_id
		JOIN course.enrollment_group_sets s ON s.id = g.group_set_id
		JOIN course.courses c ON c.id = s.course_id
		JOIN course.course_enrollments e ON e.id = m.enrollment_id
		LEFT JOIN course.enrollment_group_memberships m2 ON m2.group_id = g.id
		WHERE c.course_code = $1
		  AND e.user_id = $2
		  AND e.active = true
		GROUP BY g.id, g.group_set_id, g.name, g.sort_order, g.created_at
		ORDER BY s.sort_order ASC, g.sort_order ASC, g.name ASC
	`, courseCode, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanGroups(rows)
}

// GetGroupByCourseAndID returns the group if it belongs to the given course, or nil if not found.
func GetGroupByCourseAndID(ctx context.Context, pool *pgxpool.Pool, courseCode string, groupID uuid.UUID) (*GroupPublic, error) {
	row := pool.QueryRow(ctx, `
		SELECT g.id, g.group_set_id, g.name, g.sort_order, g.created_at,
		       COUNT(m.enrollment_id) AS member_count
		FROM course.enrollment_groups g
		JOIN course.enrollment_group_sets s ON s.id = g.group_set_id
		JOIN course.courses c ON c.id = s.course_id
		LEFT JOIN course.enrollment_group_memberships m ON m.group_id = g.id
		WHERE c.course_code = $1
		  AND g.id = $2
		GROUP BY g.id, g.group_set_id, g.name, g.sort_order, g.created_at
	`, courseCode, groupID)
	var g GroupPublic
	if err := row.Scan(&g.ID, &g.GroupSetID, &g.Name, &g.SortOrder, &g.CreatedAt, &g.MemberCount); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &g, nil
}

func scanGroups(rows pgx.Rows) ([]GroupPublic, error) {
	out := []GroupPublic{}
	for rows.Next() {
		var g GroupPublic
		if err := rows.Scan(&g.ID, &g.GroupSetID, &g.Name, &g.SortOrder, &g.CreatedAt, &g.MemberCount); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
