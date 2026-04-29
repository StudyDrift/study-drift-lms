package concepts

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListConceptsQuery filters global/course concept catalog rows (Rust ListConceptsQuery).
type ListConceptsQuery struct {
	ParentSlug *string
	Bloom      *string
	Q          *string
}

func ListConcepts(ctx context.Context, pool *pgxpool.Pool, q ListConceptsQuery) ([]ConceptRow, error) {
	var parentID *uuid.UUID
	if q.ParentSlug != nil && *q.ParentSlug != "" {
		p, err := GetBySlug(ctx, pool, *q.ParentSlug)
		if err != nil {
			return nil, err
		}
		if p == nil {
			return []ConceptRow{}, nil
		}
		parentID = &p.ID
	}
	rows, err := pool.Query(ctx, `
SELECT
	c.id,
	c.course_id,
	c.slug,
	c.name,
	c.description,
	c.bloom_level::text,
	c.parent_concept_id,
	c.difficulty_tier,
	(c.decay_lambda)::float8,
	c.created_at,
	c.updated_at
FROM course.concepts c
WHERE ($1::uuid IS NULL OR c.parent_concept_id = $1)
  AND ($2::text IS NULL OR c.bloom_level::text = $2)
  AND (
    $3::text IS NULL
    OR trim($3) = ''
    OR to_tsvector('english', c.name || ' ' || COALESCE(c.description, ''))
       @@ websearch_to_tsquery('english', $3)
  )
ORDER BY c.name ASC
`, parentID, q.Bloom, q.Q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanConceptRows(rows)
}

func SearchConceptsFTS(ctx context.Context, pool *pgxpool.Pool, search string, limit int64) ([]ConceptRow, error) {
	q := search
	for len(q) > 0 && (q[0] == ' ' || q[0] == '\t' || q[0] == '\n') {
		q = q[1:]
	}
	if q == "" {
		return []ConceptRow{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	rows, err := pool.Query(ctx, `
SELECT
	c.id,
	c.course_id,
	c.slug,
	c.name,
	c.description,
	c.bloom_level::text,
	c.parent_concept_id,
	c.difficulty_tier,
	(c.decay_lambda)::float8,
	c.created_at,
	c.updated_at
FROM course.concepts c
WHERE to_tsvector('english', c.name || ' ' || COALESCE(c.description, ''))
      @@ websearch_to_tsquery('english', $1)
ORDER BY ts_rank(
    to_tsvector('english', c.name || ' ' || COALESCE(c.description, '')),
    websearch_to_tsquery('english', $1)
) DESC,
c.name ASC
LIMIT $2
`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanConceptRows(rows)
}

func DeleteConcept(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `DELETE FROM course.concepts WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func scanConceptRows(rows pgx.Rows) ([]ConceptRow, error) {
	var out []ConceptRow
	for rows.Next() {
		var r ConceptRow
		if err := rows.Scan(&r.ID, &r.CourseID, &r.Slug, &r.Name, &r.Description, &r.BloomLevel, &r.ParentConceptID, &r.DifficultyTier, &r.DecayLambda, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
