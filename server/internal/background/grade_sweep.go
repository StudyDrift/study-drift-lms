package background

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/config"
	"github.com/lextures/lextures/server/internal/repos/coursegrades"
	"github.com/lextures/lextures/server/internal/repos/coursemoduleassignments"
	"github.com/lextures/lextures/server/internal/repos/gradeauditevents"
	"github.com/lextures/lextures/server/internal/service/notifications"
)

func sweepScheduledReleases(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, now time.Time) {
	if pool == nil {
		return
	}
	pairs, err := coursemoduleassignments.ListStructuresWithPastDueRelease(ctx, pool, now)
	if err != nil {
		slog.Warn("grade_posting.sweep list failed", "err", err)
		return
	}
	for _, p := range pairs {
		if err := markPostedScheduled(ctx, pool, cfg, p.CourseID, p.StructureItemID, now); err != nil {
			slog.Warn("grade_posting.scheduled_release_skipped", "course_id", p.CourseID, "item_id", p.StructureItemID, "err", err)
		}
	}
}

func markPostedScheduled(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, courseID, moduleItemID uuid.UUID, at time.Time) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}

	posted, err := coursegrades.MarkPosted(ctx, tx, courseID, moduleItemID, at, nil)
	if err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	reason := "Scheduled or system release of held grades (3.8)."
	prevSt := "unposted"
	newSt := "posted"
	for _, cell := range posted {
		pts := cell.PointsEarned
		if err := gradeauditevents.Insert(ctx, tx, courseID, moduleItemID, cell.StudentUserID, nil, "posted", &pts, &pts, &prevSt, &newSt, &reason); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	notifications.NotifyGradesPostedAfterRelease(ctx, pool, cfg, courseID, moduleItemID, posted)
	slog.Info("grade_posting_completed", "course_id", courseID, "module_item_id", moduleItemID, "n", len(posted))
	return coursemoduleassignments.ClearReleaseAt(ctx, pool, courseID, moduleItemID)
}
