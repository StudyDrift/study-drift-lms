//! Recommendation analytics and instructor overrides.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{delete, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::repos::course;
use crate::repos::enrollment;
use crate::repos::recommendations as rec_repo;
use crate::repos::course_structure;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/recommendations/event", post(post_recommendation_event))
        .route(
            "/api/v1/courses/{course_code}/recommendation-overrides",
            post(post_recommendation_override),
        )
        .route(
            "/api/v1/courses/{course_code}/recommendation-overrides/{override_id}",
            delete(delete_recommendation_override),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostRecommendationEventRequest {
    pub course_id: Uuid,
    pub item_id: Option<Uuid>,
    pub surface: String,
    pub event_type: String,
    pub rank: Option<i16>,
}

async fn post_recommendation_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PostRecommendationEventRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    if !["impression", "click", "dismiss"].contains(&body.event_type.as_str()) {
        return Err(AppError::invalid_input("eventType must be impression, click, or dismiss."));
    }
    let ok = enrollment::user_has_access_by_course_id(&state.pool, body.course_id, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    rec_repo::insert_event(
        &state.pool,
        user.user_id,
        body.course_id,
        body.item_id,
        &body.surface,
        &body.event_type,
        body.rank,
    )
    .await
    .map_err(AppError::Db)?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostRecommendationOverrideRequest {
    pub structure_item_id: Uuid,
    pub override_type: String,
    #[serde(default)]
    pub surface: Option<String>,
}

async fn post_recommendation_override(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(body): Json<PostRecommendationOverrideRequest>,
) -> Result<Json<rec_repo::RecommendationOverrideRow>, AppError> {
    let user = auth_user(&state, &headers)?;
    let required = crate::repos::course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    if body.override_type != "pin" && body.override_type != "suppress" {
        return Err(AppError::invalid_input("overrideType must be pin or suppress."));
    }
    if body.override_type == "pin" {
        let n = rec_repo::count_pins_for_course(&state.pool, course_row.id).await.map_err(AppError::Db)?;
        if n >= 3 {
            return Err(AppError::invalid_input(
                "At most three pinned recommendations per course. Remove a pin before adding another.",
            ));
        }
    }

    let kinds = [
        "heading",
        "content_page",
        "assignment",
        "quiz",
        "external_link",
        "survey",
        "module",
    ];
    let n = course_structure::count_structure_items_with_kinds(
        &state.pool,
        course_row.id,
        &[body.structure_item_id],
        &kinds,
    )
    .await
    .map_err(AppError::Db)?;
    if n == 0 {
        return Err(AppError::invalid_input("structureItemId is not part of this course outline."));
    }

    let row = rec_repo::insert_override(
        &state.pool,
        course_row.id,
        body.structure_item_id,
        &body.override_type,
        body.surface.as_deref(),
        user.user_id,
    )
    .await
    .map_err(AppError::Db)?;
    Ok(Json(row))
}

async fn delete_recommendation_override(
    State(state): State<AppState>,
    Path((course_code, override_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let required = crate::repos::course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let ok = rec_repo::delete_override_for_course(&state.pool, course_row.id, override_id)
        .await
        .map_err(AppError::Db)?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}
