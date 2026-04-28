// CAT θ persistence after adaptive quiz (port of server/src/services/irt_theta.rs).
package irttheta

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/lextures/lextures/server-new/internal/models/coursemodulequiz"
	"github.com/lextures/lextures/server-new/internal/repos/concepts"
	"github.com/lextures/lextures/server-new/internal/repos/learnermodel"
	"github.com/lextures/lextures/server-new/internal/repos/questionbank"
	"github.com/lextures/lextures/server-new/internal/service/irt"
	"github.com/lextures/lextures/server-new/internal/service/learnerstate"
	"github.com/lextures/lextures/server-new/internal/service/quizattemptgrading"
)

// ApplyCATQuizThetaUpdates updates learner_concept_states.theta and appends theta events
// for each concept tied to calibrated bank items in the CAT history.
func ApplyCATQuizThetaUpdates(
	ctx context.Context,
	pool *pgxpool.Pool,
	courseID, userID, attemptID uuid.UUID,
	hist []coursemodulequiz.AdaptiveQuizHistoryTurn,
) error {
	if !learnerstate.LearnerModelEnabled() {
		return nil
	}
	byConcept := make(map[uuid.UUID][][3]float64)
	var qids []uuid.UUID
	for _, turn := range hist {
		qs := turn.QuestionID
		if qs == nil {
			continue
		}
		qid, err := uuid.Parse(strings.TrimSpace(*qs))
		if err != nil {
			continue
		}
		qids = append(qids, qid)
	}
	qids = irt.SortUniqueUUIDs(qids)
	if len(qids) == 0 {
		return nil
	}
	tagMap, err := concepts.ConceptIDsForQuestionIDs(ctx, pool, qids)
	if err != nil {
		return err
	}

	for _, turn := range hist {
		qs := turn.QuestionID
		if qs == nil {
			continue
		}
		qid, err := uuid.Parse(strings.TrimSpace(*qs))
		if err != nil {
			continue
		}
		ent, err := questionbank.GetQuestionIRT(ctx, pool, courseID, qid)
		if err != nil {
			return err
		}
		if ent == nil {
			continue
		}
		if ent.IRTStatus != "calibrated" {
			continue
		}
		if ent.IRTA == nil || ent.IRTB == nil {
			continue
		}
		a, b := *ent.IRTA, *ent.IRTB
		if a <= 0.01 {
			continue
		}
		var u uint8
		if quizattemptgrading.AdaptiveTurnIsCorrect(&turn) {
			u = 1
		}
		tags := tagMap[qid]
		for _, cid := range tags {
			byConcept[cid] = append(byConcept[cid], [3]float64{a, b, float64(u)})
		}
	}

	for conceptID, rows := range byConcept {
		if len(rows) == 0 {
			continue
		}
		theta, se := irt.EapTheta2pl(rows)
		sePtr := se
		if err := learnermodel.RecordLearnerThetaSnapshot(ctx, pool, userID, conceptID, attemptID, theta, &sePtr, int32(len(rows))); err != nil {
			return err
		}
	}
	return nil
}
