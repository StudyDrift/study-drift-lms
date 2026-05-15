package coursegrades

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func parseGradebookPutPoints(s string) (float64, bool) {
	t := strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if t == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return 0, false
	}
	if math.IsNaN(f) || math.IsInf(f, 0) || f < 0 || f > 1e9 {
		return 0, false
	}
	return f, true
}

// ApplyGradebookGridPut applies a bulk grade save from the instructor gradebook UI.
// Empty trimmed values delete the grade row. Unsupported item IDs are skipped.
func ApplyGradebookGridPut(ctx context.Context, pool *pgxpool.Pool, courseID uuid.UUID, grades map[string]map[string]string) error {
	if pool == nil {
		return errors.New("nil pool")
	}
	if len(grades) == 0 {
		return nil
	}
	itemSet := make(map[uuid.UUID]struct{})
	for _, row := range grades {
		for iu := range row {
			iid, err := uuid.Parse(strings.TrimSpace(iu))
			if err != nil {
				continue
			}
			itemSet[iid] = struct{}{}
		}
	}
	itemIDs := make([]uuid.UUID, 0, len(itemSet))
	for id := range itemSet {
		itemIDs = append(itemIDs, id)
	}
	if len(itemIDs) == 0 {
		return nil
	}

	rows, err := pool.Query(ctx, `
SELECT csi.id, COALESCE(NULLIF(TRIM(ma.posting_policy), ''), 'automatic')
FROM course.course_structure_items csi
LEFT JOIN course.module_assignments ma ON ma.structure_item_id = csi.id
WHERE csi.course_id = $1 AND csi.id = ANY($2::uuid[])
`, courseID, itemIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	postingByItem := make(map[uuid.UUID]string)
	for rows.Next() {
		var id uuid.UUID
		var policy string
		if err := rows.Scan(&id, &policy); err != nil {
			return err
		}
		postingByItem[id] = policy
	}
	if err := rows.Err(); err != nil {
		return err
	}

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for su, row := range grades {
		sid, err := uuid.Parse(strings.TrimSpace(su))
		if err != nil {
			continue
		}
		for iu, raw := range row {
			iid, err := uuid.Parse(strings.TrimSpace(iu))
			if err != nil {
				continue
			}
			if _, ok := postingByItem[iid]; !ok {
				continue
			}
			val := strings.TrimSpace(raw)
			if val == "" {
				if _, err := tx.Exec(ctx, `
DELETE FROM course.course_grades
WHERE student_user_id = $1 AND module_item_id = $2 AND course_id = $3
`, sid, iid, courseID); err != nil {
					return err
				}
				continue
			}
			pts, ok := parseGradebookPutPoints(val)
			if !ok {
				return fmt.Errorf("invalid points for student %s item %s", sid, iid)
			}

			if postingByItem[iid] == "automatic" {
				_, err = tx.Exec(ctx, `
INSERT INTO course.course_grades (course_id, student_user_id, module_item_id, points_earned, updated_at, posted_at)
VALUES ($1, $2, $3, $4, NOW(), NOW())
ON CONFLICT (student_user_id, module_item_id) DO UPDATE SET
	course_id = EXCLUDED.course_id,
	points_earned = EXCLUDED.points_earned,
	updated_at = NOW(),
	posted_at = COALESCE(course.course_grades.posted_at, NOW())
`, courseID, sid, iid, pts)
			} else {
				_, err = tx.Exec(ctx, `
INSERT INTO course.course_grades (course_id, student_user_id, module_item_id, points_earned, updated_at, posted_at)
VALUES ($1, $2, $3, $4, NOW(), NULL)
ON CONFLICT (student_user_id, module_item_id) DO UPDATE SET
	course_id = EXCLUDED.course_id,
	points_earned = EXCLUDED.points_earned,
	updated_at = NOW(),
	posted_at = course.course_grades.posted_at
`, courseID, sid, iid, pts)
			}
			if err != nil {
				return err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}
