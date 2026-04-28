package learnermodel

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type LearnerConceptStateRow struct {
	UserID      uuid.UUID
	CourseID    uuid.UUID
	ConceptID   uuid.UUID
	Mastery     float64
	Engine      string
	UpdatedAt   time.Time
}

func ListStatesForUserAndCourse(ctx context.Context, pool *pgxpool.Pool, userID, courseID uuid.UUID) ([]LearnerConceptStateRow, error) {
	rows, err := pool.Query(ctx, `
SELECT user_id, course_id, concept_id, (mastery)::float8, engine, updated_at
FROM course.learner_model_states
WHERE user_id = $1 AND course_id = $2
ORDER BY concept_id ASC
`, userID, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]LearnerConceptStateRow, 0)
	for rows.Next() {
		var r LearnerConceptStateRow
		if err := rows.Scan(&r.UserID, &r.CourseID, &r.ConceptID, &r.Mastery, &r.Engine, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func GetStateForUserConcept(ctx context.Context, pool *pgxpool.Pool, userID, conceptID uuid.UUID) (*LearnerConceptStateRow, error) {
	var r LearnerConceptStateRow
	err := pool.QueryRow(ctx, `
SELECT user_id, course_id, concept_id, (mastery)::float8, engine, updated_at
FROM course.learner_model_states
WHERE user_id = $1 AND concept_id = $2
`, userID, conceptID).Scan(&r.UserID, &r.CourseID, &r.ConceptID, &r.Mastery, &r.Engine, &r.UpdatedAt)
	if err != nil {
		return nil, nil
	}
	return &r, nil
}

func EffectiveMasteryEngine(courseEngine, fallback string) string {
	if courseEngine != "" {
		return courseEngine
	}
	return fallback
}
