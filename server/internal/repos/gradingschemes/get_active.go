package gradingschemes

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is an active `course.grading_schemes` row joined from the course.
type Row struct {
	ID                   uuid.UUID
	CourseID             uuid.UUID
	Name                 string
	GradingDisplayType   string
	ScaleJSON            *json.RawMessage
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// GetActiveForCourse returns the course’s linked scheme (Rust `get_active_for_course`).
func GetActiveForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) (*Row, error) {
	var r Row
	var scale []byte
	err := pool.QueryRow(ctx, `
		SELECT s.id, s.course_id, s.name, s.grading_display_type, s.scale_json, s.created_at, s.updated_at
		FROM course.grading_schemes s
		INNER JOIN course.courses c ON c.grading_scheme_id = s.id
		WHERE c.id = $1
	`, courseID).Scan(
		&r.ID, &r.CourseID, &r.Name, &r.GradingDisplayType, &scale, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if len(scale) > 0 {
		b := json.RawMessage(append([]byte(nil), scale...))
		r.ScaleJSON = &b
	}
	return &r, nil
}
