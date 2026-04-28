// Package irtcalibration is a partial port of server/src/services/irt_calibration_job.rs.
// The 2PL marginal calibration and question_bank writer paths are not yet in Go: jobs only log a placeholder.
package irtcalibration

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RunInBackground is invoked after a 202 from POST /api/v1/admin/jobs/irt-calibrate.
// A full port will read targets, fit 2PL, and persist; until then, this only logs a structured line.
func RunInBackground(pool *pgxpool.Pool, jobID uuid.UUID, conceptID *uuid.UUID) {
	go func() {
		if pool == nil {
			return
		}
		cid := "<all>"
		if conceptID != nil {
			cid = conceptID.String()
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			log.Printf("irt calibration jobId=%s conceptId=%s: ping: %v", jobID, cid, err)
			return
		}
		log.Printf("irt calibration jobId=%s conceptId=%s: 2PL calibration is not yet implemented in the Go server (no-op).", jobID, cid)
	}()
}
