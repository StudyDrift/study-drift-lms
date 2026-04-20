use chrono::{DateTime, Utc};

use crate::error::AppError;
use crate::models::late_submission_policy::validate_late_submission_policy_pair;

pub const MAX_ASSIGNMENT_ACCESS_CODE_LEN: usize = 128;

pub fn validate_assignment_delivery_settings(
    available_from: Option<DateTime<Utc>>,
    available_until: Option<DateTime<Utc>>,
    assignment_access_code: Option<&str>,
    submission_allow_text: bool,
    submission_allow_file_upload: bool,
    submission_allow_url: bool,
) -> Result<(), AppError> {
    if let (Some(a), Some(b)) = (available_from, available_until) {
        if a > b {
            return Err(AppError::invalid_input(
                "availableFrom must be before or equal to availableUntil.",
            ));
        }
    }
    if let Some(code) = assignment_access_code {
        if code.len() > MAX_ASSIGNMENT_ACCESS_CODE_LEN {
            return Err(AppError::invalid_input(
                "assignmentAccessCode is too long (max 128 characters).",
            ));
        }
    }
    if !submission_allow_text && !submission_allow_file_upload && !submission_allow_url {
        return Err(AppError::invalid_input(
            "At least one submission type must be enabled (text, file upload, or URL).",
        ));
    }
    Ok(())
}

pub fn validate_assignment_late_settings(
    late_submission_policy: &str,
    late_penalty_percent: Option<i32>,
) -> Result<(), AppError> {
    validate_late_submission_policy_pair(late_submission_policy, late_penalty_percent)
}
