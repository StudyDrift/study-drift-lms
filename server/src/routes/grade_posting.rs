//! Per-assignment grade post / retract (plan 3.8).

use axum::{
    extract::Path,
    extract::State,
    http::HeaderMap,
    http::StatusCode,
    routing::post,
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::repos::course;
use crate::repos::course_grants;
use crate::services::grading::posting;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/post-grades",
            post(post_all_handler).delete(delete_retract_all_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/post-grades/select",
            post(post_select_handler),
        )
}

async fn post_all_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    if !state.grade_posting_policies_enabled {
        return Err(AppError::NotFound);
    }
    let user = auth_user(&state, &headers)?;
    require_course(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    posting::mark_posted_instructor(
        &state.pool,
        course_id,
        item_id,
        Utc::now(),
        None,
        user.user_id,
        false,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn post_select_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<PostGradesSelectBody>,
) -> Result<StatusCode, AppError> {
    if !state.grade_posting_policies_enabled {
        return Err(AppError::NotFound);
    }
    if body.student_user_ids.is_empty() {
        return Err(AppError::invalid_input("Select at least one student."));
    }
    let user = auth_user(&state, &headers)?;
    require_course(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let ids: Vec<Uuid> = body.student_user_ids;
    posting::mark_posted_instructor(
        &state.pool,
        course_id,
        item_id,
        Utc::now(),
        Some(&ids),
        user.user_id,
        false,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_retract_all_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    if !state.grade_posting_policies_enabled {
        return Err(AppError::NotFound);
    }
    let user = auth_user(&state, &headers)?;
    require_course(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    posting::mark_unposted_instructor(
        &state.pool,
        course_id,
        item_id,
        None,
        user.user_id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostGradesSelectBody {
    student_user_ids: Vec<Uuid>,
}

async fn require_course(
    state: &AppState,
    course_code: &str,
    user_id: Uuid,
) -> Result<(), AppError> {
    crate::routes::courses::require_course_access(state, course_code, user_id).await
}
