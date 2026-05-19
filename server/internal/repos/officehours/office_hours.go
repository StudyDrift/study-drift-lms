// Package officehours provides DB access for office-hour scheduling (plan 6.7).
package officehours

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AvailabilityWindow is a row in course.availability_windows.
type AvailabilityWindow struct {
	ID                  string     `json:"id"`
	InstructorID        string     `json:"instructorId"`
	CourseID            *string    `json:"courseId,omitempty"`
	DayOfWeek           *int       `json:"dayOfWeek,omitempty"`
	WindowDate          *string    `json:"windowDate,omitempty"`
	StartTime           string     `json:"startTime"`
	EndTime             string     `json:"endTime"`
	SlotDurationMinutes int        `json:"slotDurationMinutes"`
	Location            *string    `json:"location,omitempty"`
	IsVirtual           bool       `json:"isVirtual"`
	Status              string     `json:"status"`
	CreatedAt           time.Time  `json:"createdAt"`
}

// AppointmentSlot is a row in course.appointment_slots.
type AppointmentSlot struct {
	ID          string     `json:"id"`
	WindowID    string     `json:"windowId"`
	SlotStart   time.Time  `json:"slotStart"`
	SlotEnd     time.Time  `json:"slotEnd"`
	StudentID   *string    `json:"studentId,omitempty"`
	StudentNote *string    `json:"studentNote,omitempty"`
	MeetingID   *string    `json:"meetingId,omitempty"`
	Status      string     `json:"status"`
	BookedAt    *time.Time `json:"bookedAt,omitempty"`
}

// CreateWindow inserts a new availability window and generates slots for the upcoming 4 weeks.
func CreateWindow(
	ctx context.Context, pool *pgxpool.Pool,
	instructorID uuid.UUID,
	courseID *uuid.UUID,
	dayOfWeek *int,
	windowDate *string,
	startTime, endTime string,
	slotDurationMinutes int,
	location *string,
	isVirtual bool,
) (*AvailabilityWindow, []*AppointmentSlot, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var courseIDStr *string
	if courseID != nil {
		s := courseID.String()
		courseIDStr = &s
	}

	w := &AvailabilityWindow{}
	var dow *int16
	if dayOfWeek != nil {
		v := int16(*dayOfWeek)
		dow = &v
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO course.availability_windows
		  (instructor_id, course_id, day_of_week, window_date, start_time, end_time,
		   slot_duration_minutes, location, is_virtual)
		VALUES ($1, $2, $3, $4, $5::time, $6::time, $7, $8, $9)
		RETURNING id, instructor_id, course_id, day_of_week, window_date::text,
		          start_time::text, end_time::text, slot_duration_minutes,
		          location, is_virtual, status, created_at
	`, instructorID, courseIDStr, dow, windowDate, startTime, endTime,
		slotDurationMinutes, location, isVirtual,
	).Scan(
		&w.ID, &w.InstructorID, &w.CourseID,
		&w.DayOfWeek, &w.WindowDate,
		&w.StartTime, &w.EndTime, &w.SlotDurationMinutes,
		&w.Location, &w.IsVirtual, &w.Status, &w.CreatedAt,
	)
	if err != nil {
		return nil, nil, err
	}

	wid, _ := uuid.Parse(w.ID)
	slots, err := generateSlots(ctx, tx, wid, w, 28)
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return w, slots, nil
}

// generateSlots creates appointment_slots rows for the window over the next `days` calendar days.
func generateSlots(ctx context.Context, tx pgx.Tx, windowID uuid.UUID, w *AvailabilityWindow, days int) ([]*AppointmentSlot, error) {
	start, err := time.Parse("15:04:05", w.StartTime)
	if err != nil {
		// Try HH:MM format
		start, err = time.Parse("15:04", w.StartTime)
		if err != nil {
			return nil, err
		}
	}
	end, err := time.Parse("15:04:05", w.EndTime)
	if err != nil {
		end, err = time.Parse("15:04", w.EndTime)
		if err != nil {
			return nil, err
		}
	}

	now := time.Now().UTC()
	var candidate []time.Time

	if w.DayOfWeek != nil {
		// Recurring: find all matching weekdays in the next `days` days.
		target := time.Weekday(*w.DayOfWeek)
		for i := 0; i < days; i++ {
			d := now.AddDate(0, 0, i)
			if d.Weekday() == target {
				candidate = append(candidate, d)
			}
		}
	} else if w.WindowDate != nil {
		// One-off: single date.
		d, err := time.Parse("2006-01-02", *w.WindowDate)
		if err != nil {
			return nil, err
		}
		candidate = append(candidate, d)
	}

	duration := time.Duration(w.SlotDurationMinutes) * time.Minute
	var out []*AppointmentSlot

	for _, day := range candidate {
		cursor := time.Date(day.Year(), day.Month(), day.Day(),
			start.Hour(), start.Minute(), 0, 0, time.UTC)
		endOfDay := time.Date(day.Year(), day.Month(), day.Day(),
			end.Hour(), end.Minute(), 0, 0, time.UTC)

		for !cursor.Before(endOfDay) || cursor.Add(duration).After(endOfDay) {
			slotEnd := cursor.Add(duration)
			if slotEnd.After(endOfDay) {
				break
			}
			s := &AppointmentSlot{}
			err := tx.QueryRow(ctx, `
				INSERT INTO course.appointment_slots (window_id, slot_start, slot_end)
				VALUES ($1, $2, $3)
				ON CONFLICT (window_id, slot_start) DO NOTHING
				RETURNING id, window_id, slot_start, slot_end, student_id, student_note, meeting_id, status, booked_at
			`, windowID, cursor, slotEnd).Scan(
				&s.ID, &s.WindowID, &s.SlotStart, &s.SlotEnd,
				&s.StudentID, &s.StudentNote, &s.MeetingID, &s.Status, &s.BookedAt,
			)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return nil, err
			}
			if err == nil {
				out = append(out, s)
			}
			cursor = slotEnd
		}
	}
	return out, nil
}

// ListSlotsByCourse returns upcoming appointment slots for a course (next 4 weeks).
func ListSlotsByCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]*AppointmentSlot, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.id, s.window_id, s.slot_start, s.slot_end,
		       s.student_id, s.student_note, s.meeting_id, s.status, s.booked_at
		FROM course.appointment_slots s
		JOIN course.availability_windows w ON w.id = s.window_id
		WHERE w.course_id = $1
		  AND s.slot_start >= now()
		  AND s.slot_start <= now() + INTERVAL '28 days'
		  AND s.status != 'cancelled'
		  AND w.status = 'active'
		ORDER BY s.slot_start ASC
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSlots(rows)
}

// ListWindowsByCourse returns availability windows for a course.
func ListWindowsByCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]*AvailabilityWindow, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, instructor_id, course_id, day_of_week, window_date::text,
		       start_time::text, end_time::text, slot_duration_minutes,
		       location, is_virtual, status, created_at
		FROM course.availability_windows
		WHERE course_id = $1 AND status = 'active'
		ORDER BY day_of_week ASC NULLS LAST, window_date ASC NULLS LAST, start_time ASC
	`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*AvailabilityWindow
	for rows.Next() {
		w := &AvailabilityWindow{}
		if err := rows.Scan(
			&w.ID, &w.InstructorID, &w.CourseID,
			&w.DayOfWeek, &w.WindowDate,
			&w.StartTime, &w.EndTime, &w.SlotDurationMinutes,
			&w.Location, &w.IsVirtual, &w.Status, &w.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// GetSlotByID returns a single slot.
func GetSlotByID(ctx context.Context, pool *pgxpool.Pool, slotID uuid.UUID) (*AppointmentSlot, error) {
	s := &AppointmentSlot{}
	err := pool.QueryRow(ctx, `
		SELECT id, window_id, slot_start, slot_end,
		       student_id, student_note, meeting_id, status, booked_at
		FROM course.appointment_slots WHERE id = $1
	`, slotID).Scan(
		&s.ID, &s.WindowID, &s.SlotStart, &s.SlotEnd,
		&s.StudentID, &s.StudentNote, &s.MeetingID, &s.Status, &s.BookedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return s, err
}

// BookSlot atomically books a slot for a student. Returns 409 error on conflict.
var ErrAlreadyBooked = errors.New("slot already booked")

func BookSlot(ctx context.Context, pool *pgxpool.Pool, slotID, studentID uuid.UUID, note *string) (*AppointmentSlot, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Row-level lock to prevent double-booking.
	var currentStatus string
	err = tx.QueryRow(ctx,
		`SELECT status FROM course.appointment_slots WHERE id = $1 FOR UPDATE`,
		slotID,
	).Scan(&currentStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if currentStatus != "available" {
		return nil, ErrAlreadyBooked
	}

	s := &AppointmentSlot{}
	err = tx.QueryRow(ctx, `
		UPDATE course.appointment_slots
		SET student_id = $2, student_note = $3, status = 'booked', booked_at = now()
		WHERE id = $1
		RETURNING id, window_id, slot_start, slot_end,
		          student_id, student_note, meeting_id, status, booked_at
	`, slotID, studentID, note).Scan(
		&s.ID, &s.WindowID, &s.SlotStart, &s.SlotEnd,
		&s.StudentID, &s.StudentNote, &s.MeetingID, &s.Status, &s.BookedAt,
	)
	if err != nil {
		return nil, err
	}
	return s, tx.Commit(ctx)
}

// CancelBooking cancels a student's booking and frees the slot.
var ErrNotBookedByStudent = errors.New("slot not booked by this student")

func CancelBooking(ctx context.Context, pool *pgxpool.Pool, slotID, studentID uuid.UUID) (*AppointmentSlot, error) {
	s := &AppointmentSlot{}
	err := pool.QueryRow(ctx, `
		UPDATE course.appointment_slots
		SET student_id = NULL, student_note = NULL, status = 'available', booked_at = NULL
		WHERE id = $1 AND student_id = $2 AND status = 'booked'
		RETURNING id, window_id, slot_start, slot_end,
		          student_id, student_note, meeting_id, status, booked_at
	`, slotID, studentID).Scan(
		&s.ID, &s.WindowID, &s.SlotStart, &s.SlotEnd,
		&s.StudentID, &s.StudentNote, &s.MeetingID, &s.Status, &s.BookedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotBookedByStudent
	}
	return s, err
}

// ListMyAppointments returns a user's upcoming booked slots.
func ListMyAppointments(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) ([]*AppointmentSlot, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, window_id, slot_start, slot_end,
		       student_id, student_note, meeting_id, status, booked_at
		FROM course.appointment_slots
		WHERE student_id = $1 AND status = 'booked' AND slot_start >= now()
		ORDER BY slot_start ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSlots(rows)
}

// GetWindowBySlotID returns the availability window for a given slot (for iCal / access checks).
func GetWindowBySlotID(ctx context.Context, pool *pgxpool.Pool, slotID uuid.UUID) (*AvailabilityWindow, error) {
	w := &AvailabilityWindow{}
	err := pool.QueryRow(ctx, `
		SELECT w.id, w.instructor_id, w.course_id, w.day_of_week, w.window_date::text,
		       w.start_time::text, w.end_time::text, w.slot_duration_minutes,
		       w.location, w.is_virtual, w.status, w.created_at
		FROM course.availability_windows w
		JOIN course.appointment_slots s ON s.window_id = w.id
		WHERE s.id = $1
	`, slotID).Scan(
		&w.ID, &w.InstructorID, &w.CourseID,
		&w.DayOfWeek, &w.WindowDate,
		&w.StartTime, &w.EndTime, &w.SlotDurationMinutes,
		&w.Location, &w.IsVirtual, &w.Status, &w.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return w, err
}

func scanSlots(rows pgx.Rows) ([]*AppointmentSlot, error) {
	var out []*AppointmentSlot
	for rows.Next() {
		s := &AppointmentSlot{}
		if err := rows.Scan(
			&s.ID, &s.WindowID, &s.SlotStart, &s.SlotEnd,
			&s.StudentID, &s.StudentNote, &s.MeetingID, &s.Status, &s.BookedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
