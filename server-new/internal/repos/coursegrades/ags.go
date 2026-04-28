// Inbound LTI 1.3 AGS score passback (parity with server apply_inbound_ags_score).
package coursegrades

import (
	"context"
	"errors"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UpsertPointsFromLTI sets points_earned for a grade cell (clamped 0..scoreMaximum, cap 1e9 like Rust).
func UpsertPointsFromLTI(ctx context.Context, pool *pgxpool.Pool, courseID, studentID, moduleItemID uuid.UUID, scoreGiven, scoreMaximum float64) error {
	if pool == nil {
		return errors.New("db pool is nil")
	}
	if !validFloat(scoreGiven) || !validFloat(scoreMaximum) || scoreMaximum <= 0 {
		return errors.New("invalid score values")
	}
	p := math.Min(math.Max(0, scoreGiven), scoreMaximum)
	if p > 1e9 {
		p = 1e9
	}
	_, err := pool.Exec(ctx, `
INSERT INTO course.course_grades (course_id, student_user_id, module_item_id, points_earned, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (student_user_id, module_item_id) DO UPDATE SET
	course_id = EXCLUDED.course_id,
	points_earned = EXCLUDED.points_earned,
	updated_at = NOW()
`, courseID, studentID, moduleItemID, p)
	return err
}

func validFloat(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }
