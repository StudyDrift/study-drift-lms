use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, patch, post, put},
    Json, Router,
};
use serde::Deserialize;
use sqlx::Error as SqlxError;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{auth_user, require_permission};
use crate::models::rbac::UserBrief;
use crate::models::settings_account::{
    AccountProfileResponse, GenerateAvatarRequest, GenerateAvatarResponse, PatchUserStudentIdRequest,
    UpdateAccountProfileRequest,
};
use crate::models::settings_ai::{
    AiModelOption, AiModelsListResponse, AiSettingsResponse, AiSettingsUpdateRequest,
};
use crate::models::settings_system_prompts::{
    SystemPromptItem, SystemPromptUpdateRequest, SystemPromptsListResponse,
};
use crate::repos::rbac;
use crate::repos::system_prompts;
use crate::repos::user;
use crate::repos::user_ai_settings;
use crate::services::ai::OpenRouterError;
use crate::services::ai::{list_image_models, list_text_models};
use crate::services::settings_ops;
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
        .route(
            "/api/v1/settings/users/{user_id}/student-id",
            patch(patch_user_student_id_handler),
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
        return Err(AppError::invalid_input("Invalid prompt key."));
    }
    let content = req.content.trim();
    if content.is_empty() {
        return Err(AppError::invalid_input("Prompt content is required."));
    }
    if content.len() > 500_000 {
        return Err(AppError::invalid_input("Prompt is too long."));
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

fn map_sid_unique_violation(e: SqlxError) -> AppError {
    if let Some(db) = e.as_database_error() {
        if db.code().as_deref() == Some("23505") {
            return AppError::invalid_input("That student ID is already assigned to another user.");
        }
    }
    AppError::Db(e)
}

fn normalize_student_id(s: Option<String>) -> Result<Option<String>, AppError> {
    let Some(s) = s else {
        return Ok(None);
    };
    let t = s.trim();
    if t.is_empty() {
        return Ok(None);
    }
    if t.len() > 128 {
        return Err(AppError::invalid_input(
            "Student ID must be at most 128 characters.",
        ));
    }
    Ok(Some(t.to_string()))
}

async fn get_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AccountProfileResponse>, AppError> {
    let auth = auth_user(&state, &headers)?;
    let row = user::get_profile_by_id(&state.pool, auth.user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(settings_ops::to_profile_response(row)))
}

async fn patch_user_student_id_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Json(req): Json<PatchUserStudentIdRequest>,
) -> Result<Json<UserBrief>, AppError> {
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    if !rbac::user_exists(&state.pool, user_id).await? {
        return Err(AppError::NotFound);
    }
    let sid = normalize_student_id(req.sid)?;
    user::set_user_sid(&state.pool, user_id, sid.as_deref())
        .await
        .map_err(map_sid_unique_violation)?;
    let row = rbac::get_user_brief(&state.pool, user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn patch_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpdateAccountProfileRequest>,
) -> Result<Json<AccountProfileResponse>, AppError> {
    let auth = auth_user(&state, &headers)?;
    let row = settings_ops::patch_account_profile(&state.pool, auth.user_id, req).await?;
    Ok(Json(row))
}

async fn generate_avatar_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<GenerateAvatarRequest>,
) -> Result<Json<GenerateAvatarResponse>, AppError> {
    let auth = auth_user(&state, &headers)?;
    let prompt = req.prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::invalid_input(
            "Describe the avatar you want.",
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
    require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;

    let listed = match query.kind {
        AiModelsKind::Image => list_image_models().await,
        AiModelsKind::Text => list_text_models().await,
    }
    .map_err(|e| {
        tracing::error!(error = %e, "OpenRouter list models failed");
        AppError::invalid_input(format!(
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
    let user = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
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
    let user = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let image_model_id = req.image_model_id.trim();
    if image_model_id.is_empty() {
        return Err(AppError::invalid_input("Choose an image model."));
    }
    let course_setup_model_id = req.course_setup_model_id.trim();
    if course_setup_model_id.is_empty() {
        return Err(AppError::invalid_input(
            "Choose a course setup model.",
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
