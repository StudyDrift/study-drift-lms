package coursegrades

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PostedCell is one student grade cell updated by MarkPosted.
type PostedCell struct {
	StudentUserID uuid.UUID
	PointsEarned  float64
}

// MarkPosted sets posted_at on held grade cells (Rust `course_grades::mark_posted`).
func MarkPosted(ctx context.Context, tx pgx.Tx, courseID, moduleItemID uuid.UUID, at time.Time, onlyStudents []uuid.UUID) ([]PostedCell, error) {
	if len(onlyStudents) > 0 {
		rows, err := tx.Query(ctx, `
UPDATE course.course_grades
SET posted_at = $4, updated_at = NOW()
WHERE course_id = $1 AND module_item_id = $2
  AND posted_at IS NULL
  AND student_user_id = ANY($3)
RETURNING student_user_id, points_earned
`, courseID, moduleItemID, onlyStudents, at)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanPostedCells(rows)
	}
	rows, err := tx.Query(ctx, `
UPDATE course.course_grades
SET posted_at = $3, updated_at = NOW()
WHERE course_id = $1 AND module_item_id = $2
  AND posted_at IS NULL
RETURNING student_user_id, points_earned
`, courseID, moduleItemID, at)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPostedCells(rows)
}

func scanPostedCells(rows pgx.Rows) ([]PostedCell, error) {
	var out []PostedCell
	for rows.Next() {
		var c PostedCell
		if err := rows.Scan(&c.StudentUserID, &c.PointsEarned); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
