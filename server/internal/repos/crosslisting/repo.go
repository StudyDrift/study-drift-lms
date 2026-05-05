// Package crosslisting implements plan 5.5 cross-list group membership and queries.
package crosslisting

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxMembersPerGroup = 10

// Group is a cross-list group for one course.
type Group struct {
	ID        uuid.UUID
	OrgID     uuid.UUID
	CourseID  uuid.UUID
	Name      *string
	CreatedAt time.Time
}

// Member is one section in a group.
type Member struct {
	SectionID  uuid.UUID
	IsPrimary  bool
	JoinedAt   time.Time
	SectionCode string
	SectionName *string
}

// GroupWithMembers is the list response shape.
type GroupWithMembers struct {
	Group
	PrimarySectionID *uuid.UUID
	Members          []Member
}

// ListForOrg returns the cross-list group for each course in the org, if any.
func ListForOrg(ctx context.Context, pool *pgxpool.Pool, orgID uuid.UUID) ([]GroupWithMembers, error) {
	rows, err := pool.Query(ctx, `
SELECT
	g.id, g.org_id, g.course_id, g.name, g.created_at,
	c.section_id, c.is_primary, c.joined_at, s.section_code, s.name
FROM course.cross_list_groups g
INNER JOIN course.cross_list_members c ON c.group_id = g.id
INNER JOIN course.course_sections s ON s.id = c.section_id
WHERE g.org_id = $1
ORDER BY g.created_at ASC, c.is_primary DESC, s.section_code ASC
`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byGroup := make(map[uuid.UUID]*GroupWithMembers)
	order := []uuid.UUID{}
	for rows.Next() {
		var gid, oid, cid uuid.UUID
		var gname sql.NullString
		var gcreated time.Time
		var secID uuid.UUID
		var isPrimary bool
		var joined time.Time
		var secCode string
		var secName sql.NullString
		if err := rows.Scan(&gid, &oid, &cid, &gname, &gcreated, &secID, &isPrimary, &joined, &secCode, &secName); err != nil {
			return nil, err
		}
		gw, ok := byGroup[gid]
		if !ok {
			var nm *string
			if gname.Valid && gname.String != "" {
				s := gname.String
				nm = &s
			}
			gw = &GroupWithMembers{
				Group: Group{
					ID:        gid,
					OrgID:     oid,
					CourseID:  cid,
					Name:      nm,
					CreatedAt: gcreated,
				},
				Members: nil,
			}
			byGroup[gid] = gw
			order = append(order, gid)
		}
		var sn *string
		if secName.Valid && secName.String != "" {
			s := secName.String
			sn = &s
		}
		m := Member{
			SectionID:   secID,
			IsPrimary:   isPrimary,
			JoinedAt:    joined,
			SectionCode: secCode,
			SectionName: sn,
		}
		gw.Members = append(gw.Members, m)
		if isPrimary {
			pid := secID
			gw.PrimarySectionID = &pid
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]GroupWithMembers, 0, len(order))
	for _, gid := range order {
		out = append(out, *byGroup[gid])
	}
	return out, nil
}

// ErrWrongOrg indicates section or course does not belong to the org.
var ErrWrongOrg = errors.New("crosslisting: org mismatch")

// ErrTooManyMembers is returned when adding would exceed the member limit.
var ErrTooManyMembers = errors.New("crosslisting: too many sections in group")

// ErrSectionBusy indicates the section is already in another group.
var ErrSectionBusy = errors.New("crosslisting: section already cross-listed")

// ErrCourseHasGroup indicates the course already has a cross-list group.
var ErrCourseHasGroup = errors.New("crosslisting: course already has a cross-list group")

// ErrCannotRemovePrimary is returned when attempting to remove the primary section from a group.
var ErrCannotRemovePrimary = errors.New("crosslisting: cannot remove primary section")

// CreateGroup creates a group with one primary section (must be active, same course/org).
func CreateGroup(ctx context.Context, pool *pgxpool.Pool, orgID, courseID, primarySectionID uuid.UUID, name *string) (*GroupWithMembers, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var secOrg, secCourse uuid.UUID
	var secStatus string
	err = tx.QueryRow(ctx, `
SELECT c.org_id, s.course_id, s.status
FROM course.course_sections s
INNER JOIN course.courses c ON c.id = s.course_id
WHERE s.id = $1
`, primarySectionID).Scan(&secOrg, &secCourse, &secStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if secOrg != orgID || secCourse != courseID {
		return nil, ErrWrongOrg
	}
	if secStatus != "active" {
		return nil, fmt.Errorf("crosslisting: section not active")
	}

	var gid uuid.UUID
	var createdAt time.Time
	var gname sql.NullString
	err = tx.QueryRow(ctx, `
INSERT INTO course.cross_list_groups (org_id, course_id, name)
VALUES ($1, $2, $3)
RETURNING id, name, created_at
`, orgID, courseID, name).Scan(&gid, &gname, &createdAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrCourseHasGroup
		}
		return nil, err
	}

	_, err = tx.Exec(ctx, `
INSERT INTO course.cross_list_members (group_id, section_id, is_primary)
VALUES ($1, $2, true)
`, gid, primarySectionID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrSectionBusy
		}
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return GetGroupForCourse(ctx, pool, courseID)
}

// AddMember adds a non-primary section to the course's group.
func AddMember(ctx context.Context, pool *pgxpool.Pool, orgID, courseID, sectionID uuid.UUID) (*GroupWithMembers, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var gid uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT g.id FROM course.cross_list_groups g
WHERE g.course_id = $1 AND g.org_id = $2
`, courseID, orgID).Scan(&gid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var n int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM course.cross_list_members WHERE group_id = $1`, gid).Scan(&n); err != nil {
		return nil, err
	}
	if n >= maxMembersPerGroup {
		return nil, ErrTooManyMembers
	}

	var secOrg, secCourse uuid.UUID
	var secStatus string
	err = tx.QueryRow(ctx, `
SELECT c.org_id, s.course_id, s.status
FROM course.course_sections s
INNER JOIN course.courses c ON c.id = s.course_id
WHERE s.id = $1
`, sectionID).Scan(&secOrg, &secCourse, &secStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if secOrg != orgID || secCourse != courseID {
		return nil, ErrWrongOrg
	}
	if secStatus != "active" {
		return nil, fmt.Errorf("crosslisting: section not active")
	}

	_, err = tx.Exec(ctx, `
INSERT INTO course.cross_list_members (group_id, section_id, is_primary)
VALUES ($1, $2, false)
`, gid, sectionID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrSectionBusy
		}
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return GetGroupForCourse(ctx, pool, courseID)
}

// RemoveMember removes a section from the course's group (never deletes grades).
func RemoveMember(ctx context.Context, pool *pgxpool.Pool, orgID, courseID, sectionID uuid.UUID) (*GroupWithMembers, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var gid uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT g.id FROM course.cross_list_groups g
WHERE g.course_id = $1 AND g.org_id = $2
`, courseID, orgID).Scan(&gid)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var isPrimary bool
	err = tx.QueryRow(ctx, `
SELECT is_primary FROM course.cross_list_members WHERE group_id = $1 AND section_id = $2
`, gid, sectionID).Scan(&isPrimary)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if isPrimary {
		return nil, ErrCannotRemovePrimary
	}

	_, err = tx.Exec(ctx, `
DELETE FROM course.cross_list_members WHERE group_id = $1 AND section_id = $2
`, gid, sectionID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return GetGroupForCourse(ctx, pool, courseID)
}

// GetGroupForCourse loads group + members or nil if none.
func GetGroupForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (*GroupWithMembers, error) {
	row := pool.QueryRow(ctx, `
SELECT g.id, g.org_id, g.course_id, g.name, g.created_at
FROM course.cross_list_groups g
WHERE g.course_id = $1
`, courseID)
	var g Group
	var gname sql.NullString
	if err := row.Scan(&g.ID, &g.OrgID, &g.CourseID, &gname, &g.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if gname.Valid && gname.String != "" {
		s := gname.String
		g.Name = &s
	}

	rows, err := pool.Query(ctx, `
SELECT c.section_id, c.is_primary, c.joined_at, s.section_code, s.name
FROM course.cross_list_members c
INNER JOIN course.course_sections s ON s.id = c.section_id
WHERE c.group_id = $1
ORDER BY c.is_primary DESC, s.section_code ASC
`, g.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var members []Member
	var primaryID *uuid.UUID
	for rows.Next() {
		var sid uuid.UUID
		var isPrimary bool
		var joined time.Time
		var code string
		var nm sql.NullString
		if err := rows.Scan(&sid, &isPrimary, &joined, &code, &nm); err != nil {
			return nil, err
		}
		var sn *string
		if nm.Valid && nm.String != "" {
			s := nm.String
			sn = &s
		}
		members = append(members, Member{
			SectionID:   sid,
			IsPrimary:   isPrimary,
			JoinedAt:    joined,
			SectionCode: code,
			SectionName: sn,
		})
		if isPrimary {
			pid := sid
			primaryID = &pid
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &GroupWithMembers{Group: g, PrimarySectionID: primaryID, Members: members}, nil
}

// SectionIDsForMergedGradebook returns all section IDs in the course's cross-list group when merged view applies.
func SectionIDsForMergedGradebook(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]uuid.UUID, bool, error) {
	g, err := GetGroupForCourse(ctx, pool, courseID)
	if err != nil || g == nil || len(g.Members) < 2 {
		return nil, false, err
	}
	out := make([]uuid.UUID, 0, len(g.Members))
	for _, m := range g.Members {
		out = append(out, m.SectionID)
	}
	return out, true, nil
}

// ExpandInstructorSectionFilter replaces a single selected section id with all cross-listed
// section ids when combined view is on (merged=true) and the course has a multi-section group.
func ExpandInstructorSectionFilter(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, filter []uuid.UUID, merged bool) ([]uuid.UUID, error) {
	if !merged || len(filter) != 1 {
		return filter, nil
	}
	groupIDs, ok, err := SectionIDsForMergedGradebook(ctx, pool, courseID)
	if err != nil || !ok {
		return filter, err
	}
	want := filter[0]
	inGroup := false
	for _, id := range groupIDs {
		if id == want {
			inGroup = true
			break
		}
	}
	if !inGroup {
		return filter, nil
	}
	return groupIDs, nil
}
