// Package irtcalibration is a partial port of server/src/services/irt_calibration_job.rs.
package irtcalibration

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server/internal/repos/questionbank"
	"github.com/lextures/lextures/server/internal/service/irt"
)

const minIRTResponses = 200

// RunInBackground is invoked after a 202 from POST /api/v1/admin/jobs/irt-calibrate.
func RunInBackground(pool *pgxpool.Pool, jobID uuid.UUID, conceptID *uuid.UUID) {
	go func() {
		if pool == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
		defer cancel()
		calibrated, examined, err := runIRTCalibration(ctx, pool, conceptID)
		if err != nil {
			slog.Warn("irt calibration job failed", "job_id", jobID, "err", err)
			return
		}
		slog.Info("irt.calibration_run_complete", "job_id", jobID, "examined", examined, "calibrated", calibrated, "concept_id", conceptID)
	}()
}

type irtTarget struct {
	courseID   uuid.UUID
	questionID uuid.UUID
}

func runIRTCalibration(ctx context.Context, pool *pgxpool.Pool, conceptID *uuid.UUID) (calibrated, examined int, err error) {
	var rows pgx.Rows
	if conceptID != nil {
		rows, err = pool.Query(ctx, `
SELECT q.course_id, q.id
FROM course.questions q
INNER JOIN course.concept_question_tags t ON t.question_id = q.id
WHERE t.concept_id = $1
  AND q.status = 'active'::course.question_status
  AND q.irt_status IN ('uncalibrated'::course.irt_calibration_status, 'pilot'::course.irt_calibration_status)
`, *conceptID)
	} else {
		rows, err = pool.Query(ctx, `
SELECT course_id, id
FROM course.questions
WHERE status = 'active'::course.question_status
  AND irt_status IN ('uncalibrated'::course.irt_calibration_status, 'pilot'::course.irt_calibration_status)
`)
	}
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	var targets []irtTarget
	for rows.Next() {
		var t irtTarget
		if err := rows.Scan(&t.courseID, &t.questionID); err != nil {
			return 0, 0, err
		}
		targets = append(targets, t)
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	for _, row := range targets {
		examined++
		bits, err := questionbank.ListBinaryResponsesForQuestion(ctx, pool, row.courseID, row.questionID)
		if err != nil {
			return calibrated, examined, err
		}
		if len(bits) < minIRTResponses {
			continue
		}
		a, b, ok := irt.Calibrate2plMarginalGrid(bits)
		if !ok {
			continue
		}
		updated, err := questionbank.UpdateQuestionIRTFitted(ctx, pool, row.courseID, row.questionID, a, b, int32(len(bits)))
		if err != nil {
			return calibrated, examined, err
		}
		if updated {
			calibrated++
			slog.Info("irt.item_calibrated", "question_id", row.questionID, "sample_n", len(bits), "a", a, "b", b)
		}
	}
	return calibrated, examined, nil
}
