package concepts

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CountPrerequisiteEdges returns the total number of rows in course.concept_prerequisites.
func CountPrerequisiteEdges(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	var n int64
	err := pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM course.concept_prerequisites`).Scan(&n)
	return n, err
}

// PrerequisiteReachesConcept reports whether adding (conceptID → prerequisiteID) would close a cycle.
// Matches `server/src/repos/concepts::prerequisite_reaches_concept` (serializable transaction recommended).
func PrerequisiteReachesConcept(ctx context.Context, tx pgx.Tx, prerequisiteID, conceptID uuid.UUID) (bool, error) {
	var found bool
	err := tx.QueryRow(ctx, `
WITH RECURSIVE reach AS (
    SELECT cp.prerequisite_id AS node, 1 AS depth
    FROM course.concept_prerequisites cp
    WHERE cp.concept_id = $1
    UNION ALL
    SELECT cp.prerequisite_id, reach.depth + 1
    FROM course.concept_prerequisites cp
    INNER JOIN reach ON cp.concept_id = reach.node
    WHERE reach.depth < 64
)
SELECT EXISTS (SELECT 1 FROM reach WHERE node = $2)
`, prerequisiteID, conceptID).Scan(&found)
	if err != nil {
		return false, err
	}
	return found, nil
}

// InsertPrerequisiteEdge inserts one prerequisite edge inside an active transaction.
func InsertPrerequisiteEdge(ctx context.Context, tx pgx.Tx, conceptID, prerequisiteID uuid.UUID) error {
	_, err := tx.Exec(ctx, `
INSERT INTO course.concept_prerequisites (concept_id, prerequisite_id)
VALUES ($1, $2)
`, conceptID, prerequisiteID)
	return err
}

// DeletePrerequisiteEdge removes one edge; returns true if a row was deleted.
func DeletePrerequisiteEdge(ctx context.Context, pool *pgxpool.Pool, conceptID, prerequisiteID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `
DELETE FROM course.concept_prerequisites
WHERE concept_id = $1 AND prerequisite_id = $2
`, conceptID, prerequisiteID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
