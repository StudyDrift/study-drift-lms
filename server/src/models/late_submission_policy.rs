//! Shared late-submission rules for quizzes and module assignments.

use crate::error::AppError;

pub const LATE_SUBMISSION_POLICIES: &[&str] = &["allow", "penalty", "block"];

/// Validates `late_submission_policy` and `late_penalty_percent` (required when policy is `penalty`).
pub fn validate_late_submission_policy_pair(
    late_submission_policy: &str,
    late_penalty_percent: Option<i32>,
) -> Result<(), AppError> {
    let p = late_submission_policy.trim();
    if !LATE_SUBMISSION_POLICIES.contains(&p) {
        return Err(AppError::InvalidInput(
            "lateSubmissionPolicy must be one of: allow, penalty, block.".into(),
        ));
    }
    if p == "penalty" {
        let Some(pp) = late_penalty_percent else {
            return Err(AppError::InvalidInput(
                "latePenaltyPercent is required when lateSubmissionPolicy is penalty.".into(),
            ));
        };
        if !(0..=100).contains(&pp) {
            return Err(AppError::InvalidInput(
                "latePenaltyPercent must be between 0 and 100.".into(),
            ));
        }
    }
    Ok(())
}
