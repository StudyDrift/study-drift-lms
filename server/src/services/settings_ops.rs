//! Validation and normalization for account and global settings routes.

use uuid::Uuid;

use crate::error::AppError;
use crate::models::settings_account::{AccountProfileResponse, UpdateAccountProfileRequest};
use crate::repos::user;

pub fn normalize_name(s: Option<String>, field_label: &str) -> Result<Option<String>, AppError> {
    let Some(s) = s else {
        return Ok(None);
    };
    let t = s.trim();
    if t.is_empty() {
        return Ok(None);
    }
    if t.len() > 80 {
        return Err(AppError::invalid_input(format!(
            "{field_label} is too long."
        )));
    }
    Ok(Some(t.to_string()))
}

pub fn normalize_avatar_url(s: Option<String>) -> Result<Option<String>, AppError> {
    let Some(s) = s else {
        return Ok(None);
    };
    let t = s.trim();
    if t.is_empty() {
        return Ok(None);
    }
    if t.len() > 2_000_000 {
        return Err(AppError::invalid_input(
            "Avatar image URL is too long.",
        ));
    }
    let is_http = t.starts_with("http://") || t.starts_with("https://");
    let is_data = t.starts_with("data:image/");
    if !is_http && !is_data {
        return Err(AppError::invalid_input(
            "Avatar must be an http(s) URL or a data:image upload.",
        ));
    }
    Ok(Some(t.to_string()))
}

pub fn normalize_ui_theme(s: Option<String>) -> Result<Option<String>, AppError> {
    let Some(s) = s else {
        return Ok(None);
    };
    let t = s.trim().to_lowercase();
    if t != "light" && t != "dark" {
        return Err(AppError::invalid_input(
            "Theme must be \"light\" or \"dark\".",
        ));
    }
    Ok(Some(t))
}

pub fn to_profile_response(row: user::UserProfileRow) -> AccountProfileResponse {
    AccountProfileResponse {
        email: row.email,
        display_name: row.display_name,
        first_name: row.first_name,
        last_name: row.last_name,
        avatar_url: row.avatar_url,
        ui_theme: row.ui_theme,
        sid: row.sid,
    }
}

pub async fn patch_account_profile(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    req: UpdateAccountProfileRequest,
) -> Result<AccountProfileResponse, AppError> {
    let first_name = normalize_name(req.first_name, "First name")?;
    let last_name = normalize_name(req.last_name, "Last name")?;
    let avatar_url = normalize_avatar_url(req.avatar_url)?;
    let ui_theme = normalize_ui_theme(req.ui_theme)?;
    let row = user::update_profile(
        pool,
        user_id,
        first_name.as_deref(),
        last_name.as_deref(),
        avatar_url.as_deref(),
        ui_theme.as_deref(),
    )
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(to_profile_response(row))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_name_trims_and_rejects_too_long() {
        assert_eq!(normalize_name(None, "X").unwrap(), None);
        assert_eq!(normalize_name(Some("  ann  ".into()), "First").unwrap(), Some("ann".into()));
        let long = "x".repeat(81);
        assert!(normalize_name(Some(long), "First").is_err());
    }

    #[test]
    fn normalize_avatar_url_accepts_http_and_data_image() {
        assert_eq!(
            normalize_avatar_url(Some(" https://x/y.png ".into())).unwrap(),
            Some("https://x/y.png".into())
        );
        assert_eq!(
            normalize_avatar_url(Some("data:image/png;base64,abc".into())).unwrap(),
            Some("data:image/png;base64,abc".into())
        );
        assert!(normalize_avatar_url(Some("ftp://bad".into())).is_err());
    }

    #[test]
    fn normalize_ui_theme_accepts_light_dark() {
        assert_eq!(normalize_ui_theme(Some("LIGHT".into())).unwrap(), Some("light".into()));
        assert!(normalize_ui_theme(Some("sepia".into())).is_err());
    }
}
