use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::models::settings_ai::{
    AiModelOption, AiModelsListResponse, AiSettingsResponse, AiSettingsUpdateRequest,
};
use crate::repos::user_ai_settings;
use crate::services::ai::{list_image_models, list_text_models};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AiModelsKind {
    Image,
    Text,
}

impl Default for AiModelsKind {
    fn default() -> Self {
        Self::Image
    }
}

#[derive(Debug, Deserialize)]
struct AiModelsQuery {
    #[serde(default)]
    kind: AiModelsKind,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/settings/ai/models", get(get_ai_models_handler))
        .route(
            "/api/v1/settings/ai",
            get(get_ai_handler).put(put_ai_handler),
        )
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
        return Err(AppError::InvalidInput(
            "Choose an image model.".into(),
        ));
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
