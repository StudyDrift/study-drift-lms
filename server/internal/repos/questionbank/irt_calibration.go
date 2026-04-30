package questionbank

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListBinaryResponsesForQuestion returns dichotomous graded outcomes (0/1) in attempt order.
func ListBinaryResponsesForQuestion(ctx context.Context, pool *pgxpool.Pool, courseID, questionID uuid.UUID) ([]byte, error) {
	qid := questionID.String()
	rows, err := pool.Query(ctx, `
SELECT CASE WHEN r.is_correct THEN 1 ELSE 0 END::int
FROM course.quiz_responses r
INNER JOIN course.quiz_attempts a ON a.id = r.attempt_id
WHERE a.course_id = $1
  AND r.question_id = $2
  AND r.is_correct IS NOT NULL
ORDER BY r.id ASC
LIMIT 100000
`, courseID, qid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var bits []byte
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		if v != 0 {
			bits = append(bits, 1)
		} else {
			bits = append(bits, 0)
		}
	}
	return bits, rows.Err()
}

// UpdateQuestionIRTFitted persists fitted 2PL parameters (Rust `question_bank::update_question_irt_fitted`).
func UpdateQuestionIRTFitted(ctx context.Context, pool *pgxpool.Pool, courseID, questionID uuid.UUID, irtA, irtB float64, sampleN int32) (bool, error) {
	tag, err := pool.Exec(ctx, `
UPDATE course.questions
SET irt_a = $3,
    irt_b = $4,
    irt_sample_n = $5,
    irt_status = 'calibrated'::course.irt_calibration_status,
    irt_calibrated_at = NOW(),
    updated_at = NOW()
WHERE id = $2 AND course_id = $1
`, courseID, questionID, irtA, irtB, sampleN)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}
