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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn bearer_token_extracts_value() {
        let mut h = axum::http::HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer abc.def.ghi"),
        );
        assert_eq!(bearer_token(&h), Some("abc.def.ghi"));
    }

    #[test]
    fn bearer_token_missing_without_header() {
        let h = axum::http::HeaderMap::new();
        assert_eq!(bearer_token(&h), None);
    }

    #[test]
    fn bearer_token_requires_bearer_scheme() {
        let mut h = axum::http::HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_static("Basic Zm9v"),
        );
        assert_eq!(bearer_token(&h), None);
    }
}
