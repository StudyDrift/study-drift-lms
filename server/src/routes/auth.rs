use axum::{
    extract::State,
    routing::post,
    Json, Router,
};

use crate::error::AppError;
use crate::models::auth::{AuthResponse, LoginRequest, SignupRequest};
use crate::services::auth;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/login", post(login_handler))
        .route("/api/v1/auth/signup", post(signup_handler))
}

async fn login_handler(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    auth::login(&state.pool, &state.jwt, req).await.map(Json)
}

async fn signup_handler(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    auth::signup(&state.pool, &state.jwt, req).await.map(Json)
}
