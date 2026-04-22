use crate::error::AppError;
use crate::repos::originality_platform_config;

const MODES: &[&str] = &["disabled", "plagiarism", "ai", "both"];
const VIS: &[&str] = &["show", "hide", "show_after_grading"];

pub fn normalize_detection_mode(raw: &str) -> Result<String, AppError> {
    let t = raw.trim();
    if MODES.contains(&t) {
        return Ok(t.to_string());
    }
    Err(AppError::invalid_input(
        "originalityDetection must be one of: disabled, plagiarism, ai, both.",
    ))
}

pub fn normalize_student_visibility(raw: &str) -> Result<String, AppError> {
    let t = raw.trim();
    if VIS.contains(&t) {
        return Ok(t.to_string());
    }
    Err(AppError::invalid_input(
        "originalityStudentVisibility must be one of: show, hide, show_after_grading.",
    ))
}

pub async fn ensure_institutional_plagiarism_allowed(
    pool: &sqlx::PgPool,
    mode: &str,
) -> Result<(), AppError> {
    if !matches!(mode, "plagiarism" | "both") {
        return Ok(());
    }
    let cfg = originality_platform_config::get_singleton(pool).await?;
    let has_dpa = cfg.dpa_accepted_at.is_some();
    let provider_ok = cfg.active_external_provider != "none";
    let key_ok = cfg
        .provider_api_key
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if has_dpa && provider_ok && key_ok {
        return Ok(());
    }
    Err(AppError::invalid_input(
        "Plagiarism detection requires institutional configuration.",
    ))
}

/// When the deployment flag is off, assignments must stay on `disabled`.
pub fn ensure_feature_flag_allows_mode(feature_enabled: bool, mode: &str) -> Result<(), AppError> {
    if feature_enabled || mode == "disabled" {
        return Ok(());
    }
    Err(AppError::invalid_input(
        "Originality detection is not enabled on this server.",
    ))
}
