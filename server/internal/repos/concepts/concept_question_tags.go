package concepts

import (
	"context"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ConceptIDsForQuestionIDs returns concept IDs tagged on each question (port of server `concept_ids_for_question_ids`).
func ConceptIDsForQuestionIDs(ctx context.Context, pool *pgxpool.Pool, questionIDs []uuid.UUID) (map[uuid.UUID][]uuid.UUID, error) {
	if len(questionIDs) == 0 {
		return map[uuid.UUID][]uuid.UUID{}, nil
	}
	rows, err := pool.Query(ctx, `
SELECT question_id, concept_id
FROM course.concept_question_tags
WHERE question_id = ANY($1::uuid[])
`, questionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := make(map[uuid.UUID][]uuid.UUID)
	for rows.Next() {
		var qid, cid uuid.UUID
		if err := rows.Scan(&qid, &cid); err != nil {
			return nil, err
		}
		m[qid] = append(m[qid], cid)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for k, v := range m {
		sort.Slice(v, func(i, j int) bool { return v[i].String() < v[j].String() })
		m[k] = v
	}
	return m, nil
}

func InsertQuestionTag(ctx context.Context, pool *pgxpool.Pool, conceptID, questionID uuid.UUID) error {
	_, err := pool.Exec(ctx, `
INSERT INTO course.concept_question_tags (concept_id, question_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING
`, conceptID, questionID)
	return err
}

func DeleteQuestionTag(ctx context.Context, pool *pgxpool.Pool, conceptID, questionID uuid.UUID) (bool, error) {
	tag, err := pool.Exec(ctx, `
DELETE FROM course.concept_question_tags
WHERE concept_id = $1 AND question_id = $2
`, conceptID, questionID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
