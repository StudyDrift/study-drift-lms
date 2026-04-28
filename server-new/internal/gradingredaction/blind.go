// Package gradingredaction provides helpers for plan 3.3 blind-grading PII redaction
// (parity with server/src/routes/blind_grading_redaction.rs).
package gradingredaction

import (
	"fmt"

	"github.com/google/uuid"
)

// BlindStudentLabel is the English default; clients may localize using blindLabel as fallback.
func BlindStudentLabel(rankOneIndexed int) string {
	if rankOneIndexed < 1 {
		rankOneIndexed = 1
	}
	return fmt.Sprintf("Student %d", rankOneIndexed)
}

// ShouldRedactSubmissionPiiForStaff is true for staff while blind grading is on and identities are not yet revealed.
func ShouldRedactSubmissionPiiForStaff(featureEnabled, blindGrading, identitiesRevealedAt bool) bool {
	return featureEnabled && blindGrading && !identitiesRevealedAt
}

// SubmissionRankByID returns 1-based rank in newest-first submission order
// (parity with server/src/routes/blind_grading_redaction::submission_rank_by_id).
func SubmissionRankByID(submissionIDsNewestFirst []uuid.UUID) map[uuid.UUID]int {
	out := make(map[uuid.UUID]int, len(submissionIDsNewestFirst))
	for i, id := range submissionIDsNewestFirst {
		out[id] = i + 1
	}
	return out
}
