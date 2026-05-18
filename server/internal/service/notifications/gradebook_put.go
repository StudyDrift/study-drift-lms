package notifications

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/repos/coursegrades"
)

// NotifyAutoPostedFromGradebookPut emails students when automatic posting policy released grades from the grid save.
func NotifyAutoPostedFromGradebookPut(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, courseID uuid.UUID, grades map[string]map[string]string) {
	if !cfg.EmailNotificationsEnabled || len(grades) == 0 {
		return
	}
	itemSet := make(map[uuid.UUID]struct{})
	studentSet := make(map[uuid.UUID]struct{})
	for su, row := range grades {
		sid, err := uuid.Parse(strings.TrimSpace(su))
		if err != nil {
			continue
		}
		studentSet[sid] = struct{}{}
		for iu, raw := range row {
			if strings.TrimSpace(raw) == "" {
				continue
			}
			iid, err := uuid.Parse(strings.TrimSpace(iu))
			if err != nil {
				continue
			}
			itemSet[iid] = struct{}{}
		}
	}
	if len(itemSet) == 0 || len(studentSet) == 0 {
		return
	}
	itemIDs := make([]uuid.UUID, 0, len(itemSet))
	for id := range itemSet {
		itemIDs = append(itemIDs, id)
	}
	studentIDs := make([]uuid.UUID, 0, len(studentSet))
	for id := range studentSet {
		studentIDs = append(studentIDs, id)
	}
	since := time.Now().UTC().Add(-2 * time.Minute)
	rows, err := pool.Query(ctx, `
SELECT cg.student_user_id, cg.module_item_id
FROM course.course_grades cg
JOIN course.course_structure_items csi ON csi.id = cg.module_item_id
LEFT JOIN course.module_assignments ma ON ma.structure_item_id = csi.id
WHERE cg.course_id = $1
  AND cg.student_user_id = ANY($2::uuid[])
  AND cg.module_item_id = ANY($3::uuid[])
  AND cg.posted_at IS NOT NULL
  AND cg.posted_at >= $4
  AND COALESCE(NULLIF(TRIM(ma.posting_policy), ''), 'automatic') = 'automatic'
`, courseID, studentIDs, itemIDs, since)
	if err != nil {
		return
	}
	defer rows.Close()
	type key struct{ student, item uuid.UUID }
	seen := make(map[key]struct{})
	for rows.Next() {
		var studentID, itemID uuid.UUID
		if err := rows.Scan(&studentID, &itemID); err != nil {
			return
		}
		k := key{studentID, itemID}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		NotifyGradesPostedAfterRelease(ctx, pool, cfg, courseID, itemID, []coursegrades.PostedCell{{StudentUserID: studentID}})
	}
}
