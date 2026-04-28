package coursemoduleassignment

import (
	"fmt"
	"time"

	"github.com/lextures/lextures/server-new/internal/models/latesubmissionpolicy"
)

const MaxAssignmentAccessCodeLen = 128

func ValidateAssignmentDeliverySettings(
	availableFrom *time.Time,
	availableUntil *time.Time,
	assignmentAccessCode *string,
	submissionAllowText bool,
	submissionAllowFileUpload bool,
	submissionAllowURL bool,
) error {
	if availableFrom != nil && availableUntil != nil && availableFrom.After(*availableUntil) {
		return fmt.Errorf("availableFrom must be before or equal to availableUntil")
	}
	if assignmentAccessCode != nil && len(*assignmentAccessCode) > MaxAssignmentAccessCodeLen {
		return fmt.Errorf("assignmentAccessCode is too long (max 128 characters)")
	}
	if !submissionAllowText && !submissionAllowFileUpload && !submissionAllowURL {
		return fmt.Errorf("at least one submission type must be enabled (text, file upload, or URL)")
	}
	return nil
}

func ValidateAssignmentLateSettings(lateSubmissionPolicy string, latePenaltyPercent *int32) error {
	return latesubmissionpolicy.ValidateLateSubmissionPolicyPair(lateSubmissionPolicy, latePenaltyPercent)
}
