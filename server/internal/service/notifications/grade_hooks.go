package notifications

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/repos/course"
	"github.com/lextures/lextures/server/internal/repos/coursegrades"
)

// NotifyGradesPostedAfterRelease emails students for cells just marked posted.
func NotifyGradesPostedAfterRelease(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, courseID, moduleItemID uuid.UUID, cells []coursegrades.PostedCell) {
	if !cfg.EmailNotificationsEnabled || len(cells) == 0 {
		return
	}
	code, err := course.GetCourseCodeByID(ctx, pool, courseID)
	if err != nil || code == nil {
		return
	}
	var courseTitle, assignmentTitle string
	var orgID uuid.UUID
	if err := pool.QueryRow(ctx, `
SELECT c.title, COALESCE(csi.title, 'Assignment'), c.org_id
FROM course.courses c
JOIN course.course_structure_items csi ON csi.course_id = c.id AND csi.id = $2
WHERE c.id = $1
`, courseID, moduleItemID).Scan(&courseTitle, &assignmentTitle, &orgID); err != nil {
		return
	}
	orgPtr := &orgID

	ns := &Service{Pool: pool, Config: cfg}
	for _, cell := range cells {
		ns.NotifyGradePosted(ctx, cell.StudentUserID, courseTitle, assignmentTitle, *code, orgPtr)
	}
	if len(cells) > 0 {
		slog.Info("notifications.grade_posted", "course_id", courseID, "count", len(cells))
	}
}
