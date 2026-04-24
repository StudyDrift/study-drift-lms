//! Public SAML 2.0 HTTP endpoints: `/auth/saml/*` (plan 4.1).

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use axum::Form;
use axum::{routing::get, Router};
use serde::Deserialize;
use uuid::Uuid;
use urlencoding::encode;

use crate::error::AppError;
use crate::services::auth::saml as saml_service;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/saml/metadata", get(saml_metadata_handler))
        .route("/auth/saml/login", get(saml_login_handler))
        .route("/auth/saml/acs", axum::routing::post(saml_acs_handler))
        .route("/auth/saml/slo", axum::routing::post(saml_slo_unimplemented))
}

fn require_saml(s: &AppState) -> Result<&crate::state::SamlSpSettings, AppError> {
    s.saml
        .as_ref()
        .ok_or_else(|| AppError::invalid_input("SAML is not enabled on this server."))
}

async fn saml_metadata_handler(State(s): State<AppState>) -> Result<axum::response::Response, AppError> {
    let sp = require_saml(&s)?;
    let xml = saml_service::sp_metadata_xml(sp)?;
    Ok((
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            "application/samlmetadata+xml; charset=utf-8",
        )],
        xml,
    )
        .into_response())
}

async fn saml_login_handler(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<LoginQuery>,
) -> Result<axum::response::Response, AppError> {
    let sp = require_saml(&state)?;
    let idp = q
        .idp_id
        .ok_or_else(|| AppError::invalid_input("Missing idpId query parameter."))?;
    saml_service::start_sso_redirect(&state.pool, sp, idp, q.relay_state)
        .await
        .map(IntoResponse::into_response)
}

#[derive(Deserialize)]
pub struct LoginQuery {
    #[serde(default, rename = "idpId")]
    pub idp_id: Option<Uuid>,
    #[serde(default, rename = "RelayState")]
    pub relay_state: Option<String>,
}

#[derive(Deserialize)]
pub struct AcsForm {
    #[serde(rename = "SAMLResponse")]
    pub saml_response: String,
    #[serde(default, rename = "RelayState")]
    pub relay_state: Option<String>,
}

async fn saml_acs_handler(
    State(state): State<AppState>,
    Form(f): Form<AcsForm>,
) -> Result<axum::response::Response, AppError> {
    let sp = require_saml(&state)?;
    let res = saml_service::acs_post_form(
        &state.pool,
        &state.jwt,
        sp,
        &f.saml_response,
        f.relay_state.as_deref(),
    )
    .await?;
    let token = encode(&res.access_token);
    let public = state.public_web_origin.trim_end_matches('/').to_string();
    let next_q = f
        .relay_state
        .as_deref()
        .filter(|s| s.starts_with('/'))
        .map(|p| {
            let enc = urlencoding::encode(p);
            format!("&next={enc}")
        })
        .unwrap_or_default();
    let next = format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in</title></head>
<body>
<script>location.replace("{public}/saml-callback#access_token={token}&token_type=Bearer{next_q}");</script>
<p>Redirecting to the app…</p>
</body></html>"#
    );
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        next,
    )
        .into_response())
}

async fn saml_slo_unimplemented() -> (StatusCode, String) {
    (
        StatusCode::NOT_IMPLEMENTED,
        "SAML Single Logout is not implemented yet.".to_string(),
    )
}
