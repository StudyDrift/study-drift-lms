package questionbank

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IRTFields holds 2PL column subset used for CAT and calibration (port of Rust question bank IRT).
type IRTFields struct {
	ID         uuid.UUID
	CourseID   uuid.UUID
	IRTStatus  string
	IRTA       *float64
	IRTB       *float64
}

// GetQuestionIRT returns calibrated bank item parameters when present; nil if the row is missing.
func GetQuestionIRT(ctx context.Context, pool *pgxpool.Pool, courseID, questionID uuid.UUID) (*IRTFields, error) {
	var r IRTFields
	var a, b sql.NullFloat64
	var status string
	err := pool.QueryRow(ctx, `
SELECT q.id, q.course_id, q.irt_status::text, q.irt_a, q.irt_b
FROM course.questions q
WHERE q.id = $1 AND q.course_id = $2
`, questionID, courseID).Scan(&r.ID, &r.CourseID, &status, &a, &b)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	r.IRTStatus = status
	if a.Valid {
		v := a.Float64
		r.IRTA = &v
	}
	if b.Valid {
		v := b.Float64
		r.IRTB = &v
	}
	return &r, nil
}
