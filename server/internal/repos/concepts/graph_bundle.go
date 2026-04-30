package concepts

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GraphBundle is nodes plus directed prerequisite edges [concept_id, prerequisite_id].
type GraphBundle struct {
	Nodes []ConceptRow
	Edges [][2]uuid.UUID
}

func ListAncestors(ctx context.Context, pool *pgxpool.Pool, conceptID uuid.UUID) (*GraphBundle, error) {
	rows, err := pool.Query(ctx, `
WITH RECURSIVE anc_ids AS (
    SELECT prerequisite_id AS id, 1 AS depth
    FROM course.concept_prerequisites
    WHERE concept_id = $1
    UNION ALL
    SELECT cp.prerequisite_id, anc_ids.depth + 1
    FROM course.concept_prerequisites cp
    INNER JOIN anc_ids ON cp.concept_id = anc_ids.id
    WHERE anc_ids.depth < 64
),
all_ids AS (
    SELECT id FROM anc_ids
    UNION
    SELECT $1::uuid
)
SELECT cp.concept_id, cp.prerequisite_id
FROM course.concept_prerequisites cp
WHERE cp.concept_id IN (SELECT id FROM all_ids)
  AND cp.prerequisite_id IN (SELECT id FROM all_ids)
`, conceptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return readPrereqGraph(ctx, pool, conceptID, rows)
}

func ListDescendants(ctx context.Context, pool *pgxpool.Pool, conceptID uuid.UUID) (*GraphBundle, error) {
	rows, err := pool.Query(ctx, `
WITH RECURSIVE desc_ids AS (
    SELECT concept_id AS id, 1 AS depth
    FROM course.concept_prerequisites
    WHERE prerequisite_id = $1
    UNION ALL
    SELECT cp.concept_id, desc_ids.depth + 1
    FROM course.concept_prerequisites cp
    INNER JOIN desc_ids ON cp.prerequisite_id = desc_ids.id
    WHERE desc_ids.depth < 64
),
all_ids AS (
    SELECT id FROM desc_ids
    UNION
    SELECT $1::uuid
)
SELECT cp.concept_id, cp.prerequisite_id
FROM course.concept_prerequisites cp
WHERE cp.concept_id IN (SELECT id FROM all_ids)
  AND cp.prerequisite_id IN (SELECT id FROM all_ids)
`, conceptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return readPrereqGraph(ctx, pool, conceptID, rows)
}

func readPrereqGraph(ctx context.Context, pool *pgxpool.Pool, root uuid.UUID, rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) (*GraphBundle, error) {
	nodeSet := map[uuid.UUID]struct{}{root: {}}
	var edges [][2]uuid.UUID
	seen := make(map[uuid.UUID]map[uuid.UUID]struct{})
	for rows.Next() {
		var a, b uuid.UUID
		if err := rows.Scan(&a, &b); err != nil {
			return nil, err
		}
		if seen[a] == nil {
			seen[a] = make(map[uuid.UUID]struct{})
		}
		if _, ok := seen[a][b]; ok {
			continue
		}
		seen[a][b] = struct{}{}
		edges = append(edges, [2]uuid.UUID{a, b})
		nodeSet[a] = struct{}{}
		nodeSet[b] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(nodeSet))
	for id := range nodeSet {
		ids = append(ids, id)
	}
	nodes, err := LoadConceptsByIDs(ctx, pool, ids)
	if err != nil {
		return nil, err
	}
	return &GraphBundle{Nodes: nodes, Edges: edges}, nil
}

func LoadConceptsByIDs(ctx context.Context, pool *pgxpool.Pool, ids []uuid.UUID) ([]ConceptRow, error) {
	if len(ids) == 0 {
		return []ConceptRow{}, nil
	}
	rows, err := pool.Query(ctx, `
SELECT
	id,
	course_id,
	slug,
	name,
	description,
	bloom_level::text,
	parent_concept_id,
	difficulty_tier,
	(decay_lambda)::float8,
	created_at,
	updated_at
FROM course.concepts
WHERE id = ANY($1::uuid[])
ORDER BY name ASC
`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanConceptRows(rows)
}
