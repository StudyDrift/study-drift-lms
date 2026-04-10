use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;

use crate::error::AppError;
use crate::http_auth::{auth_user, require_permission};
use crate::models::settings_account::{
    AccountProfileResponse, GenerateAvatarRequest, GenerateAvatarResponse,
    UpdateAccountProfileRequest,
};
use crate::models::settings_ai::{
    AiModelOption, AiModelsListResponse, AiSettingsResponse, AiSettingsUpdateRequest,
};
use crate::models::settings_system_prompts::{
    SystemPromptItem, SystemPromptsListResponse, SystemPromptUpdateRequest,
};
use crate::repos::user;
use crate::repos::system_prompts;
use crate::repos::user_ai_settings;
use crate::services::ai::OpenRouterError;
use crate::services::ai::{list_image_models, list_text_models};
use crate::state::AppState;

/// Same permission as Roles & Permissions — system-wide configuration.
const PERM_RBAC_MANAGE: &str = "global:app:rbac:manage";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AiModelsKind {
    #[default]
    Image,
    Text,
}

#[derive(Debug, Deserialize)]
struct AiModelsQuery {
    #[serde(default)]
    kind: AiModelsKind,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/settings/account/generate-avatar",
            post(generate_avatar_handler),
        )
        .route(
            "/api/v1/settings/account",
            get(get_account_handler).patch(patch_account_handler),
        )
        .route("/api/v1/settings/ai/models", get(get_ai_models_handler))
        .route(
            "/api/v1/settings/ai",
            get(get_ai_handler).put(put_ai_handler),
        )
        .route(
            "/api/v1/settings/system-prompts",
            get(list_system_prompts_handler),
        )
        .route(
            "/api/v1/settings/system-prompts/{key}",
            put(put_system_prompt_handler),
        )
}

async fn list_system_prompts_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<SystemPromptsListResponse>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let rows = system_prompts::list_all(&state.pool).await?;
    let prompts = rows
        .into_iter()
        .map(|r| SystemPromptItem {
            key: r.key,
            label: r.label,
            content: r.content,
            updated_at: r.updated_at,
        })
        .collect();
    Ok(Json(SystemPromptsListResponse { prompts }))
}

async fn put_system_prompt_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(key): Path<String>,
    Json(req): Json<SystemPromptUpdateRequest>,
) -> Result<Json<SystemPromptItem>, AppError> {
    let user = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let key = key.trim();
    if key.is_empty()
        || !key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(AppError::InvalidInput("Invalid prompt key.".into()));
    }
    let content = req.content.trim();
    if content.is_empty() {
        return Err(AppError::InvalidInput("Prompt content is required.".into()));
    }
    if content.len() > 500_000 {
        return Err(AppError::InvalidInput("Prompt is too long.".into()));
    }
    let row = system_prompts::update_system_prompt(&state.pool, key, content, user.user_id)
        .await
        .map_err(|e| match e {
            sqlx::Error::RowNotFound => AppError::NotFound,
            _ => e.into(),
        })?;
    Ok(Json(SystemPromptItem {
        key: row.key,
        label: row.label,
        content: row.content,
        updated_at: row.updated_at,
    }))
}

fn map_open_router_err(e: OpenRouterError) -> AppError {
    match e {
        OpenRouterError::NoImageInResponse => AppError::AiGenerationFailed(
            "The model did not return an image. Try another model in Settings.".into(),
        ),
        OpenRouterError::ApiStatus(code, msg) => AppError::AiGenerationFailed(format!(
            "OpenRouter ({code}): {}",
            msg.chars().take(800).collect::<String>()
        )),
        OpenRouterError::Http(err) => AppError::AiGenerationFailed(err.to_string()),
        OpenRouterError::Json(err) => AppError::AiGenerationFailed(err.to_string()),
    }
}

fn normalize_name(s: Option<String>, field_label: &str) -> Result<Option<String>, AppError> {
    let Some(s) = s else {
        return Ok(None);
    };
    let t = s.trim();
    if t.is_empty() {
        return Ok(None);
    }
    if t.len() > 80 {
        return Err(AppError::InvalidInput(format!(
            "{field_label} is too long."
        )));
    }
    Ok(Some(t.to_string()))
}

fn normalize_avatar_url(s: Option<String>) -> Result<Option<String>, AppError> {
    let Some(s) = s else {
        return Ok(None);
    };
    let t = s.trim();
    if t.is_empty() {
        return Ok(None);
    }
    if t.len() > 2_000_000 {
        return Err(AppError::InvalidInput(
            "Avatar image URL is too long.".into(),
        ));
    }
    let is_http = t.starts_with("http://") || t.starts_with("https://");
    let is_data = t.starts_with("data:image/");
    if !is_http && !is_data {
        return Err(AppError::InvalidInput(
            "Avatar must be an http(s) URL or a data:image upload.".into(),
        ));
    }
    Ok(Some(t.to_string()))
}

fn to_profile_response(row: user::UserProfileRow) -> AccountProfileResponse {
    AccountProfileResponse {
        email: row.email,
        display_name: row.display_name,
        first_name: row.first_name,
        last_name: row.last_name,
        avatar_url: row.avatar_url,
        ui_theme: row.ui_theme,
    }
}

fn normalize_ui_theme(s: Option<String>) -> Result<Option<String>, AppError> {
    let Some(s) = s else {
        return Ok(None);
    };
    let t = s.trim().to_lowercase();
    if t != "light" && t != "dark" {
        return Err(AppError::InvalidInput(
            "Theme must be \"light\" or \"dark\".".into(),
        ));
    }
    Ok(Some(t))
}

async fn get_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AccountProfileResponse>, AppError> {
    let auth = auth_user(&state, &headers)?;
    let row = user::get_profile_by_id(&state.pool, auth.user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(to_profile_response(row)))
}

async fn patch_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpdateAccountProfileRequest>,
) -> Result<Json<AccountProfileResponse>, AppError> {
    let auth = auth_user(&state, &headers)?;
    let first_name = normalize_name(req.first_name, "First name")?;
    let last_name = normalize_name(req.last_name, "Last name")?;
    let avatar_url = normalize_avatar_url(req.avatar_url)?;
    let ui_theme = normalize_ui_theme(req.ui_theme)?;
    let row = user::update_profile(
        &state.pool,
        auth.user_id,
        first_name.as_deref(),
        last_name.as_deref(),
        avatar_url.as_deref(),
        ui_theme.as_deref(),
    )
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(to_profile_response(row)))
}

async fn generate_avatar_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<GenerateAvatarRequest>,
) -> Result<Json<GenerateAvatarResponse>, AppError> {
    let auth = auth_user(&state, &headers)?;
    let prompt = req.prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::InvalidInput(
            "Describe the avatar you want.".into(),
        ));
    }
    let client = state
        .open_router
        .as_ref()
        .ok_or(AppError::AiNotConfigured)?;
    let model = user_ai_settings::get_image_model_id(&state.pool, auth.user_id).await?;
    let image_url = client
        .generate_image(&model, prompt)
        .await
        .map_err(map_open_router_err)?;
    Ok(Json(GenerateAvatarResponse { image_url }))
}

async fn get_ai_models_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AiModelsQuery>,
) -> Result<Json<AiModelsListResponse>, AppError> {
    auth_user(&state, &headers)?;

    let listed = match query.kind {
        AiModelsKind::Image => list_image_models().await,
        AiModelsKind::Text => list_text_models().await,
    }
    .map_err(|e| {
        tracing::error!(error = %e, "OpenRouter list models failed");
        AppError::InvalidInput(format!(
            "Could not load models from OpenRouter. Try again. ({e})"
        ))
    })?;

    let models = listed
        .into_iter()
        .map(|m| AiModelOption {
            id: m.id,
            name: m.name,
            context_length: m.context_length,
            input_price_per_million_usd: m.input_price_per_million_usd,
            output_price_per_million_usd: m.output_price_per_million_usd,
            modalities_summary: m.modalities_summary,
        })
        .collect();

    Ok(Json(AiModelsListResponse {
        configured: state.open_router.is_some(),
        models,
    }))
}

async fn get_ai_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AiSettingsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let image_model_id = user_ai_settings::get_image_model_id(&state.pool, user.user_id).await?;
    let course_setup_model_id =
        user_ai_settings::get_course_setup_model_id(&state.pool, user.user_id).await?;
    Ok(Json(AiSettingsResponse {
        image_model_id,
        course_setup_model_id,
    }))
}

async fn put_ai_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AiSettingsUpdateRequest>,
) -> Result<Json<AiSettingsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let image_model_id = req.image_model_id.trim();
    if image_model_id.is_empty() {
        return Err(AppError::InvalidInput("Choose an image model.".into()));
    }
    let course_setup_model_id = req.course_setup_model_id.trim();
    if course_setup_model_id.is_empty() {
        return Err(AppError::InvalidInput(
            "Choose a course setup model.".into(),
        ));
    }
    let (image_model_id, course_setup_model_id) = user_ai_settings::upsert_ai_settings(
        &state.pool,
        user.user_id,
        image_model_id,
        course_setup_model_id,
    )
    .await?;
    Ok(Json(AiSettingsResponse {
        image_model_id,
        course_setup_model_id,
    }))
}
