//! Public OIDC endpoints `/auth/oidc/*` (plan 4.2).

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::response::Redirect;
use axum::routing::get;
use axum::{extract::Path, extract::Query, Router};
use serde::Deserialize;
use urlencoding::encode;
use uuid::Uuid;

use crate::error::AppError;
use crate::repos::oidc as oidc_repo;
use crate::services::auth::oidc;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/oidc/{provider}/login", get(oidc_login_handler))
        .route("/auth/oidc/{provider}/callback", get(oidc_callback_handler))
}

fn require_oidc(s: &AppState) -> Result<&std::sync::Arc<crate::state::OidcState>, AppError> {
    s.oidc
        .as_ref()
        .ok_or_else(|| AppError::invalid_input("OpenID Connect is not enabled on this server."))
}

#[derive(Debug, Deserialize)]
pub struct OidcLoginQuery {
    #[serde(default, rename = "next")]
    pub next: Option<String>,
    #[serde(default, rename = "linkId")]
    pub link_id: Option<Uuid>,
    #[serde(default, rename = "configId")]
    pub config_id: Option<Uuid>,
}

async fn oidc_login_handler(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(q): Query<OidcLoginQuery>,
) -> Result<axum::response::Redirect, AppError> {
    let oidc = require_oidc(&state)?;
    let p = provider.trim().to_ascii_lowercase();
    let custom = if p == "custom" {
        let id = q
            .config_id
            .ok_or_else(|| AppError::invalid_input("Missing configId for custom OIDC."))?;
        Some(
            oidc_repo::get_custom_config(&state.pool, id)
                .await?
                .ok_or_else(|| AppError::invalid_input("Unknown custom OIDC configuration."))?,
        )
    } else {
        None
    };
    let url = oidc::build_authorize_redirect_url(
        &state.pool,
        oidc.as_ref(),
        &p,
        custom,
        q.link_id,
        q.next.as_deref(),
    )
    .await?;
    Ok(Redirect::temporary(url.as_str()))
}

#[derive(Debug, Deserialize)]
pub struct OidcCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    #[serde(default, rename = "error_description")]
    pub error_description: Option<String>,
}

async fn oidc_callback_handler(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(q): Query<OidcCallbackQuery>,
) -> Result<axum::response::Response, AppError> {
    let oidc = require_oidc(&state)?;
    let p = provider.trim().to_ascii_lowercase();
    let public = state.public_web_origin.trim_end_matches('/').to_string();

    if let Some(ref e) = q.error {
        let msg = q
            .error_description
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(e);
        let enc = encode(msg);
        let html = format!(
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in</title></head>
<body><script>location.replace("{public}/sso-error?message={enc}");</script>
<p>Redirecting…</p></body></html>"#
        );
        return Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            html,
        )
            .into_response());
    }

    let code = q
        .code
        .ok_or_else(|| AppError::invalid_input("Missing authorization code."))?;
    let st = q
        .state
        .ok_or_else(|| AppError::invalid_input("Missing state parameter."))?;

    let (res, post_next) = oidc::complete_oidc_login(
        &state.pool,
        oidc.as_ref(),
        &state.jwt,
        &p,
        &code,
        &st,
    )
    .await?;
    let token = encode(&res.access_token);
    let next = post_next
        .as_deref()
        .filter(|n| n.starts_with('/'))
        .unwrap_or("/");
    let next_q = if next == "/" {
        String::new()
    } else {
        format!("&next={}", encode(next))
    };
    let html = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in</title></head>
<body><script>location.replace("{public}/saml-callback#access_token={token}&token_type=Bearer{next_q}");</script>
<p>Redirecting to the app…</p></body></html>"#
    );
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html,
    )
        .into_response())
}
