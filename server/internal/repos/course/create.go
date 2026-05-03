package course

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
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
) (*CoursePublic, error) {
	if courseType == "" {
		courseType = defaultCourseType
	}

	for i := 0; i < maxCreateRetries; i++ {
		courseCode, err := randomCourseCode()
		if err != nil {
			return nil, err
		}
		out, retry, err := createCourseOnce(ctx, pool, createdByUserID, title, description, courseType, courseCode)
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
) (*CoursePublic, bool, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row := tx.QueryRow(ctx, `
INSERT INTO course.courses (
	course_code,
	title,
	description,
	course_type,
	created_by_user_id,
	org_id
) VALUES ($1, $2, $3, $4, $5, (SELECT org_id FROM "user".users WHERE id = $5))
RETURNING`+publicReturningColumns, courseCode, title, description, courseType, createdByUserID)

	out, err := scanCoursePublicFromRow(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, true, nil
		}
		return nil, false, err
	}

	courseID, err := uuid.Parse(out.ID)
	if err != nil {
		return nil, false, err
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO course.course_enrollments (course_id, user_id, role)
VALUES ($1, $2, 'teacher')
ON CONFLICT (course_id, user_id, role) DO NOTHING
`, courseID, createdByUserID); err != nil {
		return nil, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return &out, false, nil
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
