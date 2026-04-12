use chrono::{DateTime, Utc};

use crate::error::AppError;

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
            return Err(AppError::InvalidInput(
                "availableFrom must be before or equal to availableUntil.".into(),
            ));
        }
    }
    if let Some(code) = assignment_access_code {
        if code.len() > MAX_ASSIGNMENT_ACCESS_CODE_LEN {
            return Err(AppError::InvalidInput(
                "assignmentAccessCode is too long (max 128 characters).".into(),
            ));
        }
    }
    if !submission_allow_text && !submission_allow_file_upload && !submission_allow_url {
        return Err(AppError::InvalidInput(
            "At least one submission type must be enabled (text, file upload, or URL).".into(),
        ));
    }
    Ok(())
}
