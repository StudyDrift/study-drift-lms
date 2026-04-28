// Syllabus reads/writes for course.course_syllabus and course.syllabus_acceptances.
package course

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SyllabusSection matches the client JSON in course_syllabus.sections (JSONB).
type SyllabusSection struct {
	ID       string `json:"id"`
	Heading  string `json:"heading"`
	Markdown string `json:"markdown"`
}

// SyllabusPayload is a row of syllabus display state for a course.
type SyllabusPayload struct {
	CourseID                  uuid.UUID
	Sections                  []SyllabusSection
	UpdatedAt                 time.Time
	RequireSyllabusAcceptance bool
}

// GetSyllabusByCourseCode loads the syllabus, defaulting to empty sections when
// there is no course_syllabus row. Returns (nil, nil) when the course code is unknown.
func GetSyllabusByCourseCode(ctx context.Context, pool *pgxpool.Pool, courseCode string) (*SyllabusPayload, error) {
	if pool == nil {
		return nil, errors.New("db pool is nil")
	}
	var courseID uuid.UUID
	var raw []byte
	var updated time.Time
	var require bool
	err := pool.QueryRow(ctx, `
SELECT
	c.id,
	COALESCE(cs.sections, '[]'::jsonb),
	COALESCE(cs.updated_at, c.created_at),
	COALESCE(cs.require_syllabus_acceptance, false)
FROM course.courses c
LEFT JOIN course.course_syllabus cs ON cs.course_id = c.id
WHERE c.course_code = $1
`, courseCode).Scan(&courseID, &raw, &updated, &require)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var sections []SyllabusSection
	if err := json.Unmarshal(raw, &sections); err != nil {
		return nil, err
	}
	if sections == nil {
		sections = []SyllabusSection{}
	}
	return &SyllabusPayload{
		CourseID:                  courseID,
		Sections:                  sections,
		UpdatedAt:                 updated,
		RequireSyllabusAcceptance: require,
	}, nil
}

// HasSyllabusAcceptance is true if the user has a row in syllabus_acceptances.
func HasSyllabusAcceptance(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) (bool, error) {
	if pool == nil {
		return false, errors.New("db pool is nil")
	}
	var ok bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
	SELECT 1 FROM course.syllabus_acceptances
	WHERE user_id = $1 AND course_id = $2
)
`, userID, courseID).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok, nil
}

// RecordSyllabusAcceptance idempotently records the viewer having accepted the syllabus.
func RecordSyllabusAcceptance(ctx context.Context, pool *pgxpool.Pool, courseID, userID uuid.UUID) error {
	if pool == nil {
		return errors.New("db pool is nil")
	}
	_, err := pool.Exec(ctx, `
INSERT INTO course.syllabus_acceptances (user_id, course_id)
VALUES ($1, $2)
ON CONFLICT (user_id, course_id) DO NOTHING
`, userID, courseID)
	return err
}

// UpsertSyllabus writes syllabus content (staff). Returns updated timestamptz.
func UpsertSyllabus(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, sections []SyllabusSection, requireSyllabusAcceptance bool) (time.Time, error) {
	if pool == nil {
		return time.Time{}, errors.New("db pool is nil")
	}
	if sections == nil {
		sections = []SyllabusSection{}
	}
	raw, err := json.Marshal(sections)
	if err != nil {
		return time.Time{}, err
	}
	var updated time.Time
	err = pool.QueryRow(ctx, `
INSERT INTO course.course_syllabus (course_id, sections, require_syllabus_acceptance, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (course_id) DO UPDATE SET
	sections = EXCLUDED.sections,
	require_syllabus_acceptance = EXCLUDED.require_syllabus_acceptance,
	updated_at = now()
RETURNING updated_at
`, courseID, raw, requireSyllabusAcceptance).Scan(&updated)
	if err != nil {
		return time.Time{}, err
	}
	return updated, nil
}
