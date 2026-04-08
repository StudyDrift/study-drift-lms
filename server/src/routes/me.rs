use axum::{extract::State, http::HeaderMap, routing::get, Json, Router};

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::me::MyPermissionsResponse;
use crate::repos::rbac;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/me/permissions", get(get_my_permissions))
}

async fn get_my_permissions(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MyPermissionsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let permission_strings = rbac::list_granted_permission_strings(&state.pool, user.user_id).await?;
    Ok(Json(MyPermissionsResponse { permission_strings }))
}
