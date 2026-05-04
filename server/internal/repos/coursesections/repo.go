// Package coursesections persists plan 5.4 course sections and assignment overrides.
package coursesections

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Section is one row of course.course_sections.
type Section struct {
	ID               uuid.UUID
	CourseID         uuid.UUID
	TermID           *uuid.UUID
	SectionCode      string
	Name             *string
	InstructorUserID *uuid.UUID
	Capacity         *int
	MeetingInfo      json.RawMessage
	Status           string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func scanSection(row pgx.Row) (*Section, error) {
	var s Section
	var termID, instID sql.NullString
	var name sql.NullString
	var cap sql.NullInt32
	if err := row.Scan(
		&s.ID, &s.CourseID, &termID, &s.SectionCode, &name, &instID, &cap, &s.MeetingInfo, &s.Status, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if termID.Valid {
		u, err := uuid.Parse(termID.String)
		if err != nil {
			return nil, err
		}
		s.TermID = &u
	}
	if name.Valid && name.String != "" {
		n := name.String
		s.Name = &n
	}
	if instID.Valid {
		u, err := uuid.Parse(instID.String)
		if err != nil {
			return nil, err
		}
		s.InstructorUserID = &u
	}
	if cap.Valid {
		v := int(cap.Int32)
		s.Capacity = &v
	}
	return &s, nil
}

// ListForCourse returns active and cancelled sections (not archived) for management UIs.
func ListForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]Section, error) {
	rows, err := pool.Query(ctx, `
SELECT id, course_id, term_id, section_code, name, instructor_user_id, capacity, meeting_info, status, created_at, updated_at
FROM course.course_sections
WHERE course_id = $1 AND status <> 'archived'
ORDER BY section_code ASC
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Section
	for rows.Next() {
		s, err := scanSection(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// ListSectionIDsWhereInstructor returns section ids for this course where the user is the section instructor.
func ListSectionIDsWhereInstructor(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := pool.Query(ctx, `
SELECT id FROM course.course_sections
WHERE course_id = $1 AND instructor_user_id = $2 AND status = 'active'
`, courseID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// GetByID returns a section if it belongs to the course.
func GetByID(ctx context.Context, pool *pgxpool.Pool, courseID, sectionID uuid.UUID) (*Section, error) {
	row := pool.QueryRow(ctx, `
SELECT id, course_id, term_id, section_code, name, instructor_user_id, capacity, meeting_info, status, created_at, updated_at
FROM course.course_sections
WHERE id = $1 AND course_id = $2
`, sectionID, courseID)
	s, err := scanSection(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return s, nil
}

// Create inserts a new section.
func Create(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, sectionCode string, name *string, termID, instructorUserID *uuid.UUID, capacity *int, meetingInfo json.RawMessage) (*Section, error) {
	if len(meetingInfo) == 0 {
		meetingInfo = json.RawMessage(`{}`)
	}
	row := pool.QueryRow(ctx, `
INSERT INTO course.course_sections (course_id, term_id, section_code, name, instructor_user_id, capacity, meeting_info)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, course_id, term_id, section_code, name, instructor_user_id, capacity, meeting_info, status, created_at, updated_at
`, courseID, termID, sectionCode, name, instructorUserID, capacity, meetingInfo)
	return scanSection(row)
}

// Patch holds optional updates; nil field means leave unchanged.
type Patch struct {
	SectionCode      *string
	Name             *string // empty string clears name
	TermID           *uuid.UUID
	ClearTermID      bool
	InstructorUserID *uuid.UUID
	ClearInstructor  bool
	Capacity         *int
	ClearCapacity    bool
	MeetingInfo      *json.RawMessage
	Status           *string
}

// Update applies a patch to a section.
func Update(ctx context.Context, pool *pgxpool.Pool, courseID, sectionID uuid.UUID, p Patch) (*Section, error) {
	cur, err := GetByID(ctx, pool, courseID, sectionID)
	if err != nil {
		return nil, err
	}
	if cur == nil {
		return nil, nil
	}
	code := cur.SectionCode
	if p.SectionCode != nil {
		code = *p.SectionCode
	}
	nm := cur.Name
	if p.Name != nil {
		if *p.Name == "" {
			nm = nil
		} else {
			cp := *p.Name
			nm = &cp
		}
	}
	var termID any = cur.TermID
	if p.ClearTermID {
		termID = nil
	} else if p.TermID != nil {
		termID = *p.TermID
	}
	var inst any = cur.InstructorUserID
	if p.ClearInstructor {
		inst = nil
	} else if p.InstructorUserID != nil {
		inst = *p.InstructorUserID
	}
	var cap any = cur.Capacity
	if p.ClearCapacity {
		cap = nil
	} else if p.Capacity != nil {
		cap = *p.Capacity
	}
	mi := cur.MeetingInfo
	if p.MeetingInfo != nil {
		mi = *p.MeetingInfo
	}
	if len(mi) == 0 {
		mi = json.RawMessage(`{}`)
	}
	st := cur.Status
	if p.Status != nil {
		st = *p.Status
	}
	tag, err := pool.Exec(ctx, `
UPDATE course.course_sections
SET section_code = $1, name = $2, term_id = $3, instructor_user_id = $4, capacity = $5, meeting_info = $6, status = $7, updated_at = NOW()
WHERE id = $8 AND course_id = $9
`, code, nm, termID, inst, cap, mi, st, sectionID, courseID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, nil
	}
	return GetByID(ctx, pool, courseID, sectionID)
}

// SetStatus updates section status (e.g. archive).
func SetStatus(ctx context.Context, pool *pgxpool.Pool, courseID, sectionID uuid.UUID, status string) error {
	_, err := pool.Exec(ctx, `
UPDATE course.course_sections SET status = $1, updated_at = NOW() WHERE id = $2 AND course_id = $3
`, status, sectionID, courseID)
	return err
}

// ErrNotStudentEnrollment is returned when transfer targets a non-student row.
var ErrNotStudentEnrollment = errors.New("enrollment is not an active student")

// ErrSectionCourseMismatch when the section does not belong to the enrollment's course.
var ErrSectionCourseMismatch = errors.New("section does not belong to course")

// TransferEnrollment moves a student enrollment to another section (same course).
func TransferEnrollment(ctx context.Context, pool *pgxpool.Pool, enrollmentID, newSectionID uuid.UUID) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var courseID uuid.UUID
	var role string
	err = tx.QueryRow(ctx, `
SELECT ce.course_id, ce.role FROM course.course_enrollments ce WHERE ce.id = $1 AND ce.active
`, enrollmentID).Scan(&courseID, &role)
	if err != nil {
		return err
	}
	if role != "student" {
		return ErrNotStudentEnrollment
	}
	var secCourse uuid.UUID
	err = tx.QueryRow(ctx, `SELECT course_id FROM course.course_sections WHERE id = $1 AND status = 'active'`, newSectionID).Scan(&secCourse)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrSectionCourseMismatch
		}
		return err
	}
	if secCourse != courseID {
		return ErrSectionCourseMismatch
	}
	_, err = tx.Exec(ctx, `UPDATE course.course_enrollments SET section_id = $1 WHERE id = $2`, newSectionID, enrollmentID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Override holds optional due / availability overrides for one assignment in a section.
type Override struct {
	DueAt          *time.Time
	AvailableFrom  *time.Time
	AvailableUntil *time.Time
}

// GetOverride returns override row if any.
func GetOverride(ctx context.Context, pool *pgxpool.Pool, sectionID, structureItemID uuid.UUID) (*Override, error) {
	row := pool.QueryRow(ctx, `
SELECT due_at, available_from, available_until
FROM course.section_assignment_overrides
WHERE section_id = $1 AND structure_item_id = $2
`, sectionID, structureItemID)
	var o Override
	var due, af, au sql.NullTime
	if err := row.Scan(&due, &af, &au); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if due.Valid {
		t := due.Time
		o.DueAt = &t
	}
	if af.Valid {
		t := af.Time
		o.AvailableFrom = &t
	}
	if au.Valid {
		t := au.Time
		o.AvailableUntil = &t
	}
	return &o, nil
}

// UpsertOverride sets override columns for a section/item pair.
func UpsertOverride(ctx context.Context, pool *pgxpool.Pool, sectionID, structureItemID uuid.UUID, dueAt, availableFrom, availableUntil *time.Time) error {
	_, err := pool.Exec(ctx, `
INSERT INTO course.section_assignment_overrides (section_id, structure_item_id, due_at, available_from, available_until)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (section_id, structure_item_id) DO UPDATE SET
  due_at = EXCLUDED.due_at,
  available_from = EXCLUDED.available_from,
  available_until = EXCLUDED.available_until
`, sectionID, structureItemID, dueAt, availableFrom, availableUntil)
	return err
}

// ListOverridesForSection returns all assignment overrides for a section keyed by structure_item_id.
func ListOverridesForSection(ctx context.Context, pool *pgxpool.Pool, sectionID uuid.UUID) (map[uuid.UUID]Override, error) {
	rows, err := pool.Query(ctx, `
SELECT structure_item_id, due_at, available_from, available_until
FROM course.section_assignment_overrides
WHERE section_id = $1
`, sectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]Override)
	for rows.Next() {
		var itemID uuid.UUID
		var due, af, au sql.NullTime
		if err := rows.Scan(&itemID, &due, &af, &au); err != nil {
			return nil, err
		}
		var o Override
		if due.Valid {
			t := due.Time
			o.DueAt = &t
		}
		if af.Valid {
			t := af.Time
			o.AvailableFrom = &t
		}
		if au.Valid {
			t := au.Time
			o.AvailableUntil = &t
		}
		out[itemID] = o
	}
	return out, rows.Err()
}
