//! LTI 1.3 HTTP surface (platform + tool roles, admin registration, AGS, NRPS).

use axum::extract::{Form, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use chrono::Utc;
use jsonwebtoken::{decode, Algorithm, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};
use crate::http_auth::{bearer_token, require_permission};
use crate::repos::course;
use crate::repos::lti as lti_repo;
use crate::repos::user;
use crate::services::lti::{self, require_lti};
use crate::services::lti_jwt;
use crate::state::AppState;

const PERM_RBAC_MANAGE: &str = "global:app:rbac:manage";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/lti/provider/jwks", get(provider_jwks_handler))
        .route("/api/v1/lti/provider/login", post(provider_login_handler))
        .route("/api/v1/lti/provider/launch", post(provider_launch_handler))
        .route(
            "/api/v1/lti/provider/nrps/memberships",
            get(nrps_memberships_handler),
        )
        .route("/api/v1/lti/scores", post(post_scores_handler))
        .route("/api/v1/lti/deep-link", post(deep_link_stub_handler))
        .route("/api/v1/lti/callback", get(callback_stub_handler))
        .route(
            "/api/v1/lti/launch/{registration_id}",
            post(launch_stub_handler),
        )
        .route("/api/v1/lti/consumer/frame", get(consumer_frame_handler))
}

pub fn admin_router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/admin/lti/registrations",
            get(admin_list_handler).post(admin_create_parent_handler),
        )
        .route(
            "/api/v1/admin/lti/external-tools",
            post(admin_create_external_handler),
        )
        .route(
            "/api/v1/admin/lti/registrations/{id}",
            put(admin_put_parent_handler).delete(admin_delete_parent_handler),
        )
        .route(
            "/api/v1/admin/lti/external-tools/{id}",
            put(admin_put_external_handler).delete(admin_delete_external_handler),
        )
}

pub async fn platform_well_known_jwks(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    jwks_json(&state)
}

async fn provider_jwks_handler(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    jwks_json(&state)
}

fn jwks_json(state: &AppState) -> Result<Json<serde_json::Value>, AppError> {
    let lti = require_lti(&state)?;
    let jwk = lti.keys.jwk_public_json()?;
    Ok(Json(json!({ "keys": [jwk] })))
}

#[derive(Debug, Deserialize)]
pub struct ProviderLoginForm {
    pub iss: String,
    pub login_hint: Option<String>,
    pub target_link_uri: String,
    pub client_id: String,
    pub lti_deployment_id: Option<String>,
    pub lti_message_hint: Option<String>,
}

async fn provider_login_handler(
    State(state): State<AppState>,
    Form(form): Form<ProviderLoginForm>,
) -> Result<Redirect, AppError> {
    require_lti(&state)?;
    let pool = &state.pool;
    let Some(reg) = lti_repo::find_platform_registration(pool, &form.iss, &form.client_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if reg.tool_redirect_uris.is_empty() {
        return Err(AppError::invalid_input(
            "No tool redirect URIs configured for this registration.",
        ));
    }
    let redirect_uri = reg
        .tool_redirect_uris
        .iter()
        .find(|u| !u.trim().is_empty())
        .ok_or_else(|| AppError::invalid_input("Invalid redirect URIs."))?;

    let state_token = Uuid::new_v4().to_string();
    let nonce = Uuid::new_v4().to_string();

    let exp = Utc::now() + chrono::Duration::minutes(15);
    lti_repo::insert_oidc_state(
        pool,
        &state_token,
        &form.iss,
        &form.client_id,
        &nonce,
        &form.target_link_uri,
        form.login_hint.as_deref(),
        form.lti_deployment_id.as_deref(),
        form.lti_message_hint.as_deref(),
        exp,
    )
    .await?;

    let mut url = String::new();
    url.push_str(reg.platform_auth_url.trim_end_matches('?'));
    url.push('?');
    url.push_str("scope=openid&response_type=id_token&response_mode=form_post&prompt=none");
    url.push_str(&format!(
        "&client_id={}&redirect_uri={}&login_hint={}&state={}&nonce={}",
        urlencoding::encode(&reg.client_id),
        urlencoding::encode(redirect_uri),
        urlencoding::encode(form.login_hint.as_deref().unwrap_or("")),
        urlencoding::encode(&state_token),
        urlencoding::encode(&nonce),
    ));

    tracing::info!(target: "lti", tool_id = %reg.id, "lti.provider_login_redirect");
    Ok(Redirect::temporary(&url))
}

#[derive(Debug, Deserialize)]
pub struct ProviderLaunchForm {
    pub id_token: String,
    pub state: String,
}

async fn provider_launch_handler(
    State(state): State<AppState>,
    Form(form): Form<ProviderLaunchForm>,
) -> Result<Html<String>, AppError> {
    require_lti(&state)?;
    let pool = &state.pool;

    let Some((
        issuer,
        client_id,
        oidc_nonce,
        _target_link_uri,
        _login_hint,
        _deployment_id,
        _message_hint,
    )) = lti_repo::take_oidc_state(pool, &form.state).await?
    else {
        return Err(AppError::invalid_input("Invalid or expired OIDC state."));
    };

    let Some(reg) = lti_repo::find_platform_registration(pool, &issuer, &client_id).await? else {
        return Err(AppError::NotFound);
    };

    let key = lti_jwt::decoding_key_for_jwt(&reg.platform_jwks_url, &form.id_token).await?;
    let claims = lti_jwt::verify_lti_id_token(
        &form.id_token,
        &key,
        &reg.platform_iss,
        &reg.client_id,
    )?;

    if claims.nonce != oidc_nonce {
        return Err(AppError::invalid_input("OIDC nonce mismatch."));
    }

    let exp = chrono::DateTime::from_timestamp(claims.exp, 0).unwrap_or_else(Utc::now);
    let ok = lti_repo::try_insert_consumed_nonce(pool, &claims.nonce, exp).await?;
    if !ok {
        return Err(AppError::invalid_input_code(
            ErrorCode::NonceAlreadyUsed,
            "nonce_already_used",
        ));
    }

    let user_id = lti::resolve_or_provision_platform_user(pool, &reg.platform_iss, &claims).await?;
    let email = user::get_profile_by_id(pool, user_id)
        .await?
        .map(|p| p.email)
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "lti@user".into());
    let app_token = state
        .jwt
        .sign(user_id, &email)
        .map_err(|_| AppError::invalid_input("Could not issue session token."))?;

    let redirect = state.public_web_origin.trim_end_matches('/').to_string();
    let token_json = serde_json::to_string(&app_token).unwrap_or_else(|_| "\"\"".into());
    let redirect_json = serde_json::to_string(&format!("{redirect}/")).unwrap_or_else(|_| "\"/\"".into());

    tracing::info!(target: "lti", %user_id, platform = %reg.platform_iss, "lti.provider_launch_success");

    Ok(Html(format!(
        r#"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Signing in…</title></head>
<body><p>Signing you in…</p><script>
(() => {{
  const t = {token_json};
  try {{ localStorage.setItem('studydrift_access_token', t); }} catch (e) {{}}
  window.location.replace({redirect_json});
}})();
</script></body></html>"#
    )))
}

#[derive(Debug, Deserialize)]
pub struct NrpsQuery {
    pub course_code: String,
}

fn jwt_aud_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Array(a) => a.first().and_then(|x| x.as_str()).map(|s| s.to_string()),
        _ => None,
    }
}

async fn nrps_memberships_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<NrpsQuery>,
) -> Result<Json<Value>, AppError> {
    let lti = require_lti(&state)?;
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let body = decode_jwt_payload(token)?;
    let iss = body
        .get("iss")
        .and_then(|v| v.as_str())
        .ok_or(AppError::Unauthorized)?;
    let aud = body
        .get("aud")
        .and_then(jwt_aud_str)
        .or_else(|| body.get("client_id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .ok_or(AppError::Unauthorized)?;

    let Some(reg) = lti_repo::find_platform_registration(&state.pool, iss, &aud).await? else {
        return Err(AppError::Forbidden);
    };

    let key = lti_jwt::decoding_key_for_jwt(&reg.platform_jwks_url, token).await?;
    let mut val = Validation::new(Algorithm::RS256);
    val.validate_aud = false;
    val.set_issuer(&[reg.platform_iss.as_str()]);
    decode::<Value>(token, &key, &val).map_err(|_| AppError::Unauthorized)?;

    let base = lti.api_base_url.trim_end_matches('/');
    let doc = lti::nrps_memberships_for_course_code(&state.pool, base, &q.course_code).await?;
    Ok(Json(doc))
}

fn decode_jwt_payload(token: &str) -> Result<Value, AppError> {
    let payload_b64 = token.split('.').nth(1).ok_or(AppError::Unauthorized)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload_b64.as_bytes())
        .map_err(|_| AppError::Unauthorized)?;
    serde_json::from_slice(&bytes).map_err(|_| AppError::Unauthorized)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgsScoreRequest {
    pub line_item_url: String,
    pub student_user_id: Uuid,
    pub score_given: f64,
    pub score_maximum: f64,
}

async fn post_scores_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AgsScoreRequest>,
) -> Result<StatusCode, AppError> {
    let _lti = require_lti(&state)?;
    let token = bearer_token(&headers).ok_or(AppError::Unauthorized)?;
    let bytes = decode_jwt_payload(token)?;
    let tool_iss = bytes
        .get("iss")
        .and_then(|v| v.as_str())
        .ok_or(AppError::Unauthorized)?;
    let aud = bytes
        .get("aud")
        .and_then(jwt_aud_str)
        .ok_or(AppError::Unauthorized)?;

    let tools = lti_repo::list_external_tools(&state.pool).await?;
    let tool = tools
        .into_iter()
        .find(|t| t.active && t.tool_issuer == tool_iss && t.client_id == aud);
    let Some(tool) = tool else {
        return Err(AppError::Forbidden);
    };

    let key = lti_jwt::decoding_key_for_jwt(&tool.tool_jwks_url, token).await?;
    let mut val = Validation::new(Algorithm::RS256);
    val.validate_aud = false;
    val.set_issuer(&[tool.tool_issuer.as_str()]);
    decode::<Value>(token, &key, &val).map_err(|_| AppError::Unauthorized)?;

    lti::apply_inbound_ags_score(
        &state.pool,
        &body.line_item_url,
        body.student_user_id,
        body.score_given,
        body.score_maximum,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn deep_link_stub_handler(State(state): State<AppState>) -> Result<Response, AppError> {
    let _ = require_lti(&state)?;
    Ok((
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "message": "Deep Linking 2.0 handler not yet implemented." })),
    )
        .into_response())
}

async fn callback_stub_handler(State(state): State<AppState>) -> Result<Response, AppError> {
    let _ = require_lti(&state)?;
    Ok((
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "message": "LTI consumer OIDC callback not yet implemented." })),
    )
        .into_response())
}

async fn launch_stub_handler(
    State(state): State<AppState>,
    axum::extract::Path(_registration_id): axum::extract::Path<Uuid>,
) -> Result<Response, AppError> {
    let _ = require_lti(&state)?;
    Ok((
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "message": "LTI platform launch initiation not yet implemented." })),
    )
        .into_response())
}

#[derive(Debug, Deserialize)]
pub struct ConsumerFrameQuery {
    pub ticket: String,
}

fn esc_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

async fn consumer_frame_handler(
    State(state): State<AppState>,
    Query(q): Query<ConsumerFrameQuery>,
) -> Result<Html<String>, AppError> {
    let _lti = require_lti(&state)?;
    let (user_id, course_id, item_id) = state.jwt.verify_lti_embed_ticket(&q.ticket).map_err(|_| {
        AppError::invalid_input("Invalid or expired launch ticket.")
    })?;

    let Some(_course_code) = course::get_course_code_by_id(&state.pool, course_id).await? else {
        return Err(AppError::NotFound);
    };
    let Some(link) =
        lti_repo::get_resource_link_for_structure_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    let Some(tool) = lti_repo::get_external_tool(&state.pool, link.external_tool_id).await? else {
        return Err(AppError::NotFound);
    };
    if !tool.active {
        return Err(AppError::NotFound);
    }

    let lti_rt = state.lti.as_ref().ok_or(AppError::LtiDisabled)?;
    let hint = lti::build_platform_launch_hint_jwt(
        lti_rt,
        &tool,
        user_id,
        course_id,
        item_id,
        Some("en-US"),
    )?;

    let title = link
        .title
        .clone()
        .or_else(|| Some(tool.name.clone()))
        .unwrap_or_else(|| "External tool".into());
    let title_esc = esc_html(&title);
    let action_esc = esc_html(&tool.tool_oidc_auth_url);
    let hint_esc = esc_html(&hint);

    Ok(Html(format!(
        r#"<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>{title_esc}</title></head>
<body>
<p><a href="{action_esc}" target="_blank" rel="noopener noreferrer">Open {title_esc} in a new tab</a> if the embed is blocked.</p>
<iframe title="{title_esc}" name="f" style="width:100%;min-height:640px;border:1px solid #ccc" src="about:blank"></iframe>
<form id="p" method="post" action="{action_esc}" target="f">
  <input type="hidden" name="login_hint" value="{hint_esc}" />
</form>
<script>document.getElementById('p').submit();</script>
</body></html>"#
    )))
}

// --- Admin ---

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminListResponse {
    parent_platforms: Vec<lti_repo::LtiPlatformRegistrationRow>,
    external_tools: Vec<lti_repo::LtiExternalToolRow>,
}

async fn admin_list_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AdminListResponse>, AppError> {
    let _ = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let parent_platforms = lti_repo::list_platform_registrations(&state.pool).await?;
    let external_tools = lti_repo::list_external_tools(&state.pool).await?;
    Ok(Json(AdminListResponse {
        parent_platforms,
        external_tools,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateParentRegistrationBody {
    pub name: String,
    pub client_id: String,
    pub platform_iss: String,
    pub platform_jwks_url: String,
    pub platform_auth_url: String,
    pub platform_token_url: String,
    #[serde(default)]
    pub tool_redirect_uris: Vec<String>,
    #[serde(default)]
    pub deployment_ids: Vec<String>,
}

async fn admin_create_parent_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateParentRegistrationBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let _ = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let id = lti_repo::insert_platform_registration(
        &state.pool,
        body.name.trim(),
        body.client_id.trim(),
        body.platform_iss.trim(),
        body.platform_jwks_url.trim(),
        body.platform_auth_url.trim(),
        body.platform_token_url.trim(),
        &body.tool_redirect_uris,
        &body.deployment_ids,
    )
    .await?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateExternalToolBody {
    pub name: String,
    pub client_id: String,
    pub tool_issuer: String,
    pub tool_jwks_url: String,
    pub tool_oidc_auth_url: String,
    pub tool_token_url: Option<String>,
}

async fn admin_create_external_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateExternalToolBody>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let _ = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let id = lti_repo::insert_external_tool(
        &state.pool,
        body.name.trim(),
        body.client_id.trim(),
        body.tool_issuer.trim(),
        body.tool_jwks_url.trim(),
        body.tool_oidc_auth_url.trim(),
        body.tool_token_url.as_deref().map(str::trim).filter(|s| !s.is_empty()),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutActiveBody {
    pub active: bool,
}

async fn admin_put_parent_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(body): Json<PutActiveBody>,
) -> Result<StatusCode, AppError> {
    let _ = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let ok = lti_repo::update_platform_registration_active(&state.pool, id, body.active).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn admin_delete_parent_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let _ = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let ok = lti_repo::delete_platform_registration(&state.pool, id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn admin_put_external_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
    Json(body): Json<PutActiveBody>,
) -> Result<StatusCode, AppError> {
    let _ = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let ok = lti_repo::update_external_tool_active(&state.pool, id, body.active).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn admin_delete_external_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let _ = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let ok = lti_repo::delete_external_tool(&state.pool, id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
