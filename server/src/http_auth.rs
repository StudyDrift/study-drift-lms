//! Shared HTTP authentication helpers for API routes.

use axum::http::{header::AUTHORIZATION, HeaderMap};

use crate::error::AppError;
use crate::jwt::AuthUser;
use crate::repos::rbac;
use crate::state::AppState;

pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    value.strip_prefix("Bearer ").map(str::trim)
}

pub fn auth_user(state: &AppState, headers: &HeaderMap) -> Result<AuthUser, AppError> {
    let token = bearer_token(headers).ok_or(AppError::Unauthorized)?;
    state.jwt.verify(token).map_err(|_| AppError::Unauthorized)
}

/// Authenticates the request and ensures the user has at least one granted permission that matches `required`
/// (four segments; wildcards supported — see [`crate::authz::permission_matches`]).
pub async fn require_permission(
    state: &AppState,
    headers: &HeaderMap,
    required: &str,
) -> Result<AuthUser, AppError> {
    let user = auth_user(state, headers)?;
    rbac::validate_permission_string(required).map_err(AppError::InvalidInput)?;
    let allowed = rbac::user_has_permission(&state.pool, user.user_id, required).await?;
    if !allowed {
        return Err(AppError::Forbidden);
    }
    Ok(user)
}
