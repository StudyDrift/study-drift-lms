package course

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lextures/lextures/server/internal/repos/terms"
)

const (
	defaultCourseType = "traditional"
	courseCodePrefix  = "C-"
	courseCodeLength  = 6
	maxCreateRetries  = 8
)

// CreateCourse inserts a new course and enrolls the creator as a teacher.
func CreateCourse(
	ctx context.Context,
	pool *pgxpool.Pool,
	createdByUserID uuid.UUID,
	title string,
	description string,
	courseType string,
	orgUnitID *uuid.UUID,
	termID *uuid.UUID,
) (*CoursePublic, error) {
	if courseType == "" {
		courseType = defaultCourseType
	}

	for i := 0; i < maxCreateRetries; i++ {
		courseCode, err := randomCourseCode()
		if err != nil {
			return nil, err
		}
		out, retry, err := createCourseOnce(ctx, pool, createdByUserID, title, description, courseType, courseCode, orgUnitID, termID)
		if err != nil {
			return nil, err
		}
		if retry {
			continue
		}
		return out, nil
	}
	return nil, fmt.Errorf("failed to create unique course code after %d attempts", maxCreateRetries)
}

func createCourseOnce(
	ctx context.Context,
	pool *pgxpool.Pool,
	createdByUserID uuid.UUID,
	title string,
	description string,
	courseType string,
	courseCode string,
	orgUnitID *uuid.UUID,
	termID *uuid.UUID,
) (*CoursePublic, bool, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var courseID uuid.UUID
	var courseCodeOut string
	err = tx.QueryRow(ctx, `
INSERT INTO course.courses (
	course_code,
	title,
	description,
	course_type,
	created_by_user_id,
	org_id,
	org_unit_id,
	term_id
) VALUES ($1, $2, $3, $4, $5, (SELECT org_id FROM "user".users WHERE id = $5), $6, $7)
RETURNING id, course_code
`, courseCode, title, description, courseType, createdByUserID, orgUnitID, termID).Scan(&courseID, &courseCodeOut)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, true, nil
		}
		return nil, false, err
	}
	if courseCodeOut != courseCode {
		return nil, false, fmt.Errorf("course code mismatch")
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role)
VALUES ($1, $2, 'teacher')
ON CONFLICT (course_id, user_id, role) DO NOTHING
`, courseID, createdByUserID); err != nil {
		return nil, false, err
	}
	if err := SeedTeacherCourseGrants(ctx, tx, createdByUserID, courseID, courseCodeOut); err != nil {
		return nil, false, err
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	out, err := GetPublicByCourseCode(ctx, pool, courseCode)
	if err != nil {
		return nil, false, err
	}
	if out == nil {
		return nil, false, fmt.Errorf("course missing after create")
	}
	if termID != nil {
		trow, err := terms.GetByID(ctx, pool, *termID)
		if err == nil && trow != nil && out.StartsAt == nil && out.EndsAt == nil {
			start, e1 := time.ParseInLocation("2006-01-02", trow.StartDate, time.UTC)
			endDate, e2 := time.ParseInLocation("2006-01-02", trow.EndDate, time.UTC)
			if e1 == nil && e2 == nil {
				startT := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
				endT := time.Date(endDate.Year(), endDate.Month(), endDate.Day(), 23, 59, 59, 999999999, time.UTC)
				if u, err := UpdateCourse(ctx, pool, courseCode, out.Title, out.Description, out.Published, &startT, &endT, out.VisibleFrom, out.HiddenAt, out.ScheduleMode, out.RelativeEndAfter, out.RelativeHiddenAfter, out.RelativeScheduleAnchorAt, out.CourseHomeLanding, parseOptionalUUIDPtr(out.CourseHomeContentItemID)); err == nil && u != nil {
					out = u
				}
			}
		}
	}
	return out, false, nil
}

func parseOptionalUUIDPtr(s *string) *uuid.UUID {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	id, err := uuid.Parse(t)
	if err != nil {
		return nil
	}
	return &id
}

// RandomCourseCode returns a new candidate `C-XXXXXX` segment (caller retries on unique violation).
func RandomCourseCode() (string, error) {
	return randomCourseCode()
}

func randomCourseCode() (string, error) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, courseCodeLength)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, courseCodeLength)
	for i := range b {
		out[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return courseCodePrefix + string(out), nil
}
