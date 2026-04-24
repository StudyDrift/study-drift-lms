use axum::http::HeaderMap;
use axum::{extract::State, routing::get, routing::post, Json, Router};

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::auth::{
    AuthResponse, ForgotPasswordRequest, ForgotPasswordResponse, LoginRequest,
    ResetPasswordRequest, ResetPasswordResponse, SignupRequest,
};
use crate::repos::oidc as oidc_repo;
use crate::repos::saml as saml_repo;
use crate::services::auth;
use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/login", post(login_handler))
        .route("/api/v1/auth/signup", post(signup_handler))
        .route(
            "/api/v1/auth/forgot-password",
            post(forgot_password_handler),
        )
        .route("/api/v1/auth/reset-password", post(reset_password_handler))
        .route("/api/v1/auth/saml/status", get(saml_status_handler))
        .route("/api/v1/auth/oidc/status", get(oidc_status_handler))
        .route("/api/v1/auth/oidc/link", post(oidc_link_intent_handler))
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
    auth::request_password_reset(&state.pool, &state.mail, &state.public_web_origin, req)
        .await
        .map(Json)
}

async fn reset_password_handler(
    State(state): State<AppState>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<Json<ResetPasswordResponse>, AppError> {
    auth::reset_password(&state.pool, req).await.map(Json)
}

/// Whether SAML is enabled on this deployment and, when configured, the default IdP for the login page.
async fn saml_status_handler(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    if state.saml.is_none() {
        return Ok(Json(json!({ "enabled": false })));
    }
    let idp = saml_repo::get_default_idp(&state.pool).await?;
    if let Some(row) = idp {
        return Ok(Json(json!({
            "enabled": true,
            "idp": {
                "id": row.id,
                "label": row.display_name,
                "forceSaml": row.force_saml
            }
        })));
    }
    Ok(Json(
        json!({ "enabled": true, "idp": serde_json::Value::Null }),
    ))
}

/// Which OIDC providers are active (env or DB) for the web login buttons.
async fn oidc_status_handler(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let base = state
        .oidc
        .as_ref()
        .map(|o| o.public_base.as_str())
        .unwrap_or("");
    let custom = oidc_repo::list_custom_configs(&state.pool).await?;
    let custom_json: Vec<serde_json::Value> = custom
        .iter()
        .map(|c| {
            json!({
                "id": c.id,
                "displayName": c.display_name,
            })
        })
        .collect();
    if state.oidc.is_none() {
        return Ok(Json(json!({ "enabled": false, "providers": [], "custom": [] })));
    }
    let o = state.oidc.as_ref().unwrap();
    Ok(Json(json!({
        "enabled": true,
        "apiBase": base,
        "google": o.google.is_some(),
        "microsoft": o.microsoft.is_some(),
        "apple": o.apple.is_some(),
        "custom": custom_json
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OidcLinkIntentRequest {
    provider: String,
    #[serde(default)]
    config_id: Option<Uuid>,
}

/// Create a short-lived link for adding an IdP to the signed-in account; client opens the returned `loginUrl`.
async fn oidc_link_intent_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<OidcLinkIntentRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let u = auth_user(&state, &headers)?;
    let p = req.provider.trim().to_ascii_lowercase();
    if !matches!(p.as_str(), "google" | "microsoft" | "apple" | "custom") {
        return Err(AppError::invalid_input("Unknown OIDC provider."));
    }
    if p == "custom" {
        if req.config_id.is_none() {
            return Err(AppError::invalid_input("configId is required for custom OIDC."));
        }
    } else if req.config_id.is_some() {
        return Err(AppError::invalid_input("configId is only for custom OIDC."));
    }
    if state.oidc.is_none() {
        return Err(AppError::invalid_input("OpenID Connect is not enabled on this server."));
    }
    let id = oidc_repo::insert_link_intent(
        &state.pool,
        u.user_id,
        &p,
        if p == "custom" {
            req.config_id
        } else {
            None
        },
    )
    .await?;
    let o = state.oidc.as_ref().unwrap();
    let public = o.public_base.trim_end_matches('/');
    let path = if p == "custom" {
        let cid = req.config_id.unwrap();
        format!("/auth/oidc/custom/login?configId={cid}&linkId={id}")
    } else {
        format!("/auth/oidc/{p}/login?linkId={id}")
    };
    let login_url = format!("{public}{path}");
    Ok(Json(
        json!({ "ok": true, "linkId": id, "loginUrl": login_url }),
    ))
}

