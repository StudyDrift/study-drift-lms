package concepts

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ConceptRow struct {
	ID              uuid.UUID
	CourseID        *uuid.UUID
	Slug            string
	Name            string
	Description     *string
	BloomLevel      *string
	ParentConceptID *uuid.UUID
	DifficultyTier  string
	DecayLambda     float64
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func GetByID(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*ConceptRow, error) {
	var r ConceptRow
	err := pool.QueryRow(ctx, `
SELECT id, course_id, slug, name, description, bloom_level::text, parent_concept_id, difficulty_tier, (decay_lambda)::float8, created_at, updated_at
FROM course.concepts
WHERE id = $1
`, id).Scan(&r.ID, &r.CourseID, &r.Slug, &r.Name, &r.Description, &r.BloomLevel, &r.ParentConceptID, &r.DifficultyTier, &r.DecayLambda, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func GetBySlug(ctx context.Context, pool *pgxpool.Pool, slug string) (*ConceptRow, error) {
	var r ConceptRow
	err := pool.QueryRow(ctx, `
SELECT id, course_id, slug, name, description, bloom_level::text, parent_concept_id, difficulty_tier, (decay_lambda)::float8, created_at, updated_at
FROM course.concepts
WHERE slug = $1
`, slug).Scan(&r.ID, &r.CourseID, &r.Slug, &r.Name, &r.Description, &r.BloomLevel, &r.ParentConceptID, &r.DifficultyTier, &r.DecayLambda, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func ListConceptsForCourse(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID) ([]ConceptRow, error) {
	rows, err := pool.Query(ctx, `
SELECT id, course_id, slug, name, description, bloom_level::text, parent_concept_id, difficulty_tier, (decay_lambda)::float8, created_at, updated_at
FROM course.concepts
WHERE course_id = $1
ORDER BY name ASC
`, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ConceptRow, 0)
	for rows.Next() {
		var r ConceptRow
		if err := rows.Scan(&r.ID, &r.CourseID, &r.Slug, &r.Name, &r.Description, &r.BloomLevel, &r.ParentConceptID, &r.DifficultyTier, &r.DecayLambda, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
