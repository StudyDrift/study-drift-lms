package latesubmissionpolicy

import "fmt"

var LateSubmissionPolicies = []string{"allow", "penalty", "block"}

func ValidateLateSubmissionPolicyPair(lateSubmissionPolicy string, latePenaltyPercent *int32) error {
	switch lateSubmissionPolicy {
	case "allow", "block":
		return nil
	case "penalty":
		if latePenaltyPercent == nil {
			return fmt.Errorf("latePenaltyPercent is required when lateSubmissionPolicy is penalty")
		}
		if *latePenaltyPercent < 0 || *latePenaltyPercent > 100 {
			return fmt.Errorf("latePenaltyPercent must be between 0 and 100")
		}
		return nil
	default:
		return fmt.Errorf("lateSubmissionPolicy must be one of: allow, penalty, block")
	}
}
