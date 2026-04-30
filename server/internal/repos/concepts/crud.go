package concepts

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InsertConceptInput matches `server/src/repos/concepts::InsertConceptInput` (global concept: course_id NULL).
type InsertConceptInput struct {
	Slug            string
	Name            string
	Description     *string
	BloomLevel      *string
	ParentConceptID *uuid.UUID
}

// InsertConcept creates a course-global concept row (course_id NULL, unique slug).
func InsertConcept(ctx context.Context, pool *pgxpool.Pool, in *InsertConceptInput) (*ConceptRow, error) {
	if in == nil {
		return nil, errors.New("concepts: insert: nil input")
	}
	var r ConceptRow
	err := pool.QueryRow(ctx, `
INSERT INTO course.concepts (
    course_id, slug, name, description, bloom_level, parent_concept_id
)
VALUES (
    NULL, $1, $2, $3,
    $4::course.bloom_level,
    $5
)
RETURNING
    id, course_id, slug, name, description, bloom_level::text, parent_concept_id, difficulty_tier, (decay_lambda)::float8, created_at, updated_at
`, in.Slug, in.Name, in.Description, in.BloomLevel, in.ParentConceptID).Scan(
		&r.ID, &r.CourseID, &r.Slug, &r.Name, &r.Description, &r.BloomLevel, &r.ParentConceptID, &r.DifficultyTier, &r.DecayLambda, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// UpdateConceptInput matches `server/src/repos/concepts::UpdateConceptInput`.
type UpdateConceptInput struct {
	Name            *string
	Description     *string
	BloomLevel      *string
	ParentConceptID **uuid.UUID
}

// UpdateConcept updates a concept. If Name is nil, returns the current row (Rust behavior).
func UpdateConcept(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID, patch *UpdateConceptInput) (*ConceptRow, error) {
	if patch == nil {
		return GetByID(ctx, pool, id)
	}
	if patch.Name == nil {
		return GetByID(ctx, pool, id)
	}

	if patch.ParentConceptID != nil {
		// Option<Option<Uuid>>: inner *uuid.UUID nil => SQL NULL; non-nil => that UUID.
		inner := *patch.ParentConceptID
		var parent any
		if inner == nil {
			parent = nil
		} else {
			parent = *inner
		}
		var r ConceptRow
		err := pool.QueryRow(ctx, `
UPDATE course.concepts
SET
    name = $2,
    description = COALESCE($3, description),
    bloom_level = COALESCE($4::course.bloom_level, bloom_level),
    parent_concept_id = $5,
    updated_at = NOW()
WHERE id = $1
RETURNING
    id, course_id, slug, name, description, bloom_level::text, parent_concept_id, difficulty_tier, (decay_lambda)::float8, created_at, updated_at
`, id, *patch.Name, patch.Description, patch.BloomLevel, parent).Scan(
			&r.ID, &r.CourseID, &r.Slug, &r.Name, &r.Description, &r.BloomLevel, &r.ParentConceptID, &r.DifficultyTier, &r.DecayLambda, &r.CreatedAt, &r.UpdatedAt,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &r, nil
	}

	var r ConceptRow
	err := pool.QueryRow(ctx, `
UPDATE course.concepts
SET
    name = $2,
    description = COALESCE($3, description),
    bloom_level = COALESCE($4::course.bloom_level, bloom_level),
    updated_at = NOW()
WHERE id = $1
RETURNING
    id, course_id, slug, name, description, bloom_level::text, parent_concept_id, difficulty_tier, (decay_lambda)::float8, created_at, updated_at
`, id, *patch.Name, patch.Description, patch.BloomLevel).Scan(
		&r.ID, &r.CourseID, &r.Slug, &r.Name, &r.Description, &r.BloomLevel, &r.ParentConceptID, &r.DifficultyTier, &r.DecayLambda, &r.CreatedAt, &r.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}
