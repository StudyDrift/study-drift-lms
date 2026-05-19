// Package virtualmeetings provides DB access for virtual classroom sessions (plan 6.4).
package virtualmeetings

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Meeting is the DB row for course.virtual_meetings.
type Meeting struct {
	ID                string     `json:"id"`
	CourseID          string     `json:"courseId"`
	SectionID         *string    `json:"sectionId,omitempty"`
	Provider          string     `json:"provider"`
	Title             string     `json:"title"`
	ScheduledStart    *time.Time `json:"scheduledStart,omitempty"`
	ScheduledEnd      *time.Time `json:"scheduledEnd,omitempty"`
	JoinURL           *string    `json:"joinUrl,omitempty"`
	HostURL           *string    `json:"hostUrl,omitempty"`
	ExternalMeetingID *string    `json:"externalMeetingId,omitempty"`
	Status            string     `json:"status"`
	CreatedBy         string     `json:"createdBy"`
	CreatedAt         time.Time  `json:"createdAt"`
}

// AttendanceRecord is one row in course.meeting_attendance.
type AttendanceRecord struct {
	ID        string     `json:"id"`
	MeetingID string     `json:"meetingId"`
	UserID    string     `json:"userId"`
	JoinedAt  time.Time  `json:"joinedAt"`
	LeftAt    *time.Time `json:"leftAt,omitempty"`
	DurationS *int       `json:"durationSeconds,omitempty"`
}

// Create inserts a new meeting and returns it.
func Create(ctx context.Context, pool *pgxpool.Pool,
	courseID, createdBy uuid.UUID,
	provider, title string,
	scheduledStart, scheduledEnd *time.Time,
	joinURL, hostURL, externalMeetingID *string,
	sectionID *uuid.UUID,
) (*Meeting, error) {
	var sectionIDPtr *string
	if sectionID != nil {
		s := sectionID.String()
		sectionIDPtr = &s
	}
	m := &Meeting{}
	err := pool.QueryRow(ctx, `
		INSERT INTO course.virtual_meetings
		  (course_id, section_id, provider, title, scheduled_start, scheduled_end,
		   join_url, host_url, external_meeting_id, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, course_id, section_id, provider, title, scheduled_start, scheduled_end,
		          join_url, host_url, external_meeting_id, status, created_by, created_at
	`, courseID, sectionIDPtr, provider, title, scheduledStart, scheduledEnd,
		joinURL, hostURL, externalMeetingID, createdBy,
	).Scan(
		&m.ID, &m.CourseID, &m.SectionID, &m.Provider, &m.Title,
		&m.ScheduledStart, &m.ScheduledEnd,
		&m.JoinURL, &m.HostURL, &m.ExternalMeetingID,
		&m.Status, &m.CreatedBy, &m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return m, nil
}

// GetByID returns a meeting by UUID.
func GetByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*Meeting, error) {
	m := &Meeting{}
	err := pool.QueryRow(ctx, `
		SELECT id, course_id, section_id, provider, title, scheduled_start, scheduled_end,
		       join_url, host_url, external_meeting_id, status, created_by, created_at
		FROM course.virtual_meetings WHERE id = $1
	`, id).Scan(
		&m.ID, &m.CourseID, &m.SectionID, &m.Provider, &m.Title,
		&m.ScheduledStart, &m.ScheduledEnd,
		&m.JoinURL, &m.HostURL, &m.ExternalMeetingID,
		&m.Status, &m.CreatedBy, &m.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return m, err
}

// ListByCourse returns meetings for a course ordered by scheduled_start.
func ListByCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]*Meeting, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, course_id, section_id, provider, title, scheduled_start, scheduled_end,
		       join_url, host_url, external_meeting_id, status, created_by, created_at
		FROM course.virtual_meetings
		WHERE course_id = $1 AND status != 'cancelled'
		ORDER BY scheduled_start ASC NULLS LAST, created_at DESC
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*Meeting
	for rows.Next() {
		m := &Meeting{}
		if err := rows.Scan(
			&m.ID, &m.CourseID, &m.SectionID, &m.Provider, &m.Title,
			&m.ScheduledStart, &m.ScheduledEnd,
			&m.JoinURL, &m.HostURL, &m.ExternalMeetingID,
			&m.Status, &m.CreatedBy, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// UpdateStatus sets a meeting's status.
func UpdateStatus(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, status string) error {
	_, err := pool.Exec(ctx,
		`UPDATE course.virtual_meetings SET status = $1 WHERE id = $2`,
		status, id,
	)
	return err
}

// Update patches title, scheduled times, and URLs.
func Update(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID,
	title string,
	scheduledStart, scheduledEnd *time.Time,
	joinURL, hostURL *string,
	status string,
) (*Meeting, error) {
	m := &Meeting{}
	err := pool.QueryRow(ctx, `
		UPDATE course.virtual_meetings
		SET title = $2, scheduled_start = $3, scheduled_end = $4,
		    join_url = $5, host_url = $6, status = $7
		WHERE id = $1
		RETURNING id, course_id, section_id, provider, title, scheduled_start, scheduled_end,
		          join_url, host_url, external_meeting_id, status, created_by, created_at
	`, id, title, scheduledStart, scheduledEnd, joinURL, hostURL, status,
	).Scan(
		&m.ID, &m.CourseID, &m.SectionID, &m.Provider, &m.Title,
		&m.ScheduledStart, &m.ScheduledEnd,
		&m.JoinURL, &m.HostURL, &m.ExternalMeetingID,
		&m.Status, &m.CreatedBy, &m.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return m, err
}

// UpsertAttendance inserts an attendance record (or updates joined_at on conflict).
func UpsertAttendance(ctx context.Context, pool *pgxpool.Pool, meetingID, userID uuid.UUID) (*AttendanceRecord, error) {
	a := &AttendanceRecord{}
	err := pool.QueryRow(ctx, `
		INSERT INTO course.meeting_attendance (meeting_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT (meeting_id, user_id) DO UPDATE SET joined_at = now()
		RETURNING id, meeting_id, user_id, joined_at, left_at, duration_s
	`, meetingID, userID).Scan(
		&a.ID, &a.MeetingID, &a.UserID, &a.JoinedAt, &a.LeftAt, &a.DurationS,
	)
	return a, err
}

// ListAttendance returns attendance records for a meeting.
func ListAttendance(ctx context.Context, pool *pgxpool.Pool, meetingID uuid.UUID) ([]*AttendanceRecord, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, meeting_id, user_id, joined_at, left_at, duration_s
		FROM course.meeting_attendance
		WHERE meeting_id = $1
		ORDER BY joined_at ASC
	`, meetingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*AttendanceRecord
	for rows.Next() {
		a := &AttendanceRecord{}
		if err := rows.Scan(&a.ID, &a.MeetingID, &a.UserID, &a.JoinedAt, &a.LeftAt, &a.DurationS); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// EnrolledStudentIDs returns the user IDs of all active student-equivalent enrollees in the course.
func EnrolledStudentIDs(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := pool.Query(ctx, `
		SELECT ce.user_id
		FROM course.course_enrollments ce
		INNER JOIN course.enrollment_roles er ON er.role_key = ce.role AND er.is_student_equivalent = true
		WHERE ce.course_id = $1 AND ce.active = true
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
