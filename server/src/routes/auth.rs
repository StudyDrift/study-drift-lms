use axum::{extract::State, routing::post, Json, Router};

use crate::error::AppError;
use crate::models::auth::{
    AuthResponse, ForgotPasswordRequest, ForgotPasswordResponse, LoginRequest, ResetPasswordRequest,
    ResetPasswordResponse, SignupRequest,
};
use crate::services::auth;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/login", post(login_handler))
        .route("/api/v1/auth/signup", post(signup_handler))
        .route("/api/v1/auth/forgot-password", post(forgot_password_handler))
        .route("/api/v1/auth/reset-password", post(reset_password_handler))
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

async fn forgot_password_handler(
    State(state): State<AppState>,
    Json(req): Json<ForgotPasswordRequest>,
) -> Result<Json<ForgotPasswordResponse>, AppError> {
    auth::request_password_reset(
        &state.pool,
        &state.mail,
        &state.public_web_origin,
        req,
    )
    .await
    .map(Json)
}

async fn reset_password_handler(
    State(state): State<AppState>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<Json<ResetPasswordResponse>, AppError> {
    auth::reset_password(&state.pool, req).await.map(Json)
}
