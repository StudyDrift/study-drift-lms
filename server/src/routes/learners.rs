//! Learner knowledge state API (`/api/v1/learners/...`).

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::repos::learner_model;
use crate::services::learner_state::{
    assert_can_batch_read_learner_states, assert_can_read_learner_state, ConceptStateResponse,
    LearnerConceptsBatchResponse, LearnerConceptsListResponse, LearnerStateService,
    DEFAULT_LEARNER_STATE_SERVICE,
};
use crate::services::recommendations::{self as rec_service, RecommendationsResponse};
use crate::services::srs::{
    get_review_queue, get_review_stats, submit_review, SubmitSrsReviewBody,
};
use crate::repos::course;
use crate::repos::enrollment;
use crate::repos::misconceptions as misconception_repo;
use crate::state::AppState;

const MAX_BATCH_USER_IDS: usize = 200;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/learners/{user_id}/concepts",
            get(list_learner_concepts),
        )
        .route(
            "/api/v1/learners/{user_id}/concepts/{concept_id}",
            get(get_one_concept_state),
        )
        .route(
            "/api/v1/learners/{user_id}/concepts/{concept_id}/theta",
            get(get_learner_concept_theta_handler),
        )
        .route("/api/v1/learners/concepts/batch", post(batch_learner_concepts))
        .route(
            "/api/v1/learners/{user_id}/review-queue",
            get(get_review_queue_handler),
        )
        .route(
            "/api/v1/learners/{user_id}/review-stats",
            get(get_review_stats_handler),
        )
        .route(
            "/api/v1/learners/{user_id}/review",
            post(post_review_handler),
        )
        .route(
            "/api/v1/learners/{user_id}/recommendations",
            get(get_learner_recommendations),
        )
        .route(
            "/api/v1/learners/{user_id}/misconception-summary",
            get(get_misconception_summary_handler),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewQueueQuery {
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    offset: Option<i64>,
}

async fn get_review_queue_handler(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Query(q): Query<ReviewQueueQuery>,
    headers: HeaderMap,
) -> Result<Json<crate::services::srs::ReviewQueueResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_can_read_learner_state(&state.pool, user.user_id, user_id).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0).max(0);
    let body = get_review_queue(&state.pool, user_id, limit, offset).await?;
    Ok(Json(body))
}

async fn get_review_stats_handler(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<crate::services::srs::ReviewStatsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_can_read_learner_state(&state.pool, user.user_id, user_id).await?;
    let body = get_review_stats(&state.pool, user_id).await?;
    Ok(Json(body))
}

async fn post_review_handler(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SubmitSrsReviewBody>,
) -> Result<Json<crate::services::srs::SubmitSrsReviewResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let res = submit_review(&state.pool, user.user_id, user_id, body).await?;
    Ok(Json(res))
}

async fn list_learner_concepts(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<LearnerConceptsListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_can_read_learner_state(&state.pool, user.user_id, user_id).await?;

    let concepts = DEFAULT_LEARNER_STATE_SERVICE
        .list_concept_states(&state.pool, user_id, None)
        .await?;
    Ok(Json(LearnerConceptsListResponse { concepts }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LearnerConceptThetaResponse {
    pub theta: Option<f64>,
    pub theta_se: Option<f64>,
    pub last_updated_at: Option<DateTime<Utc>>,
}

async fn get_learner_concept_theta_handler(
    State(state): State<AppState>,
    Path((user_id, concept_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<LearnerConceptThetaResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_can_read_learner_state(&state.pool, user.user_id, user_id).await?;

    let row = learner_model::get_learner_theta_meta(&state.pool, user_id, concept_id)
        .await
        .map_err(AppError::Db)?;
    let Some(row) = row else {
        return Ok(Json(LearnerConceptThetaResponse {
            theta: None,
            theta_se: None,
            last_updated_at: None,
        }));
    };
    Ok(Json(LearnerConceptThetaResponse {
        theta: row.theta,
        theta_se: row.theta_se,
        last_updated_at: row.updated_at,
    }))
}

async fn get_one_concept_state(
    State(state): State<AppState>,
    Path((user_id, concept_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ConceptStateResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_can_read_learner_state(&state.pool, user.user_id, user_id).await?;

    let row = learner_model::get_state_for_user_concept(&state.pool, user_id, concept_id)
        .await
        .map_err(AppError::Db)?;
    let Some(row) = row else {
        return Err(AppError::NotFound);
    };
    Ok(Json(ConceptStateResponse::from(row)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerConceptsBatchRequest {
    pub user_ids: Vec<Uuid>,
    #[serde(default)]
    pub concept_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecommendationsQuery {
    course_id: Uuid,
    #[serde(default = "default_surface")]
    surface: String,
    #[serde(default)]
    limit: Option<usize>,
}

fn default_surface() -> String {
    "continue".into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MisconceptionSummaryQuery {
    course_code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LearnerMisconceptionSummaryResponse {
    recurring: Vec<misconception_repo::MisconceptionSummaryRow>,
    all_time_count: i64,
}

async fn get_misconception_summary_handler(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Query(q): Query<MisconceptionSummaryQuery>,
    headers: HeaderMap,
) -> Result<Json<LearnerMisconceptionSummaryResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_can_read_learner_state(&state.pool, user.user_id, user_id).await?;

    let course_code = q.course_code.trim();
    if course_code.is_empty() {
        return Err(AppError::invalid_input("courseCode is required."));
    }
    let ok = enrollment::user_has_access(&state.pool, course_code, user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let Some(course_id) = course::get_id_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    let recurring = misconception_repo::list_recurring_for_user_course(&state.pool, user_id, course_id, 3)
        .await
        .map_err(AppError::Db)?;
    let all_time_count = misconception_repo::count_all_events_for_user_course(&state.pool, user_id, course_id)
        .await
        .map_err(AppError::Db)?;
    Ok(Json(LearnerMisconceptionSummaryResponse {
        recurring,
        all_time_count,
    }))
}

async fn get_learner_recommendations(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Query(q): Query<RecommendationsQuery>,
    headers: HeaderMap,
) -> Result<Json<RecommendationsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_can_read_learner_state(&state.pool, user.user_id, user_id).await?;

    let surface = q.surface.trim();
    if !matches!(
        surface,
        "continue" | "strengthen" | "challenge" | "review"
    ) {
        return Err(AppError::invalid_input(
            "surface must be continue, strengthen, challenge, or review.",
        ));
    }

    let ok = enrollment::user_has_access_by_course_id(&state.pool, q.course_id, user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }

    let limit = q.limit.unwrap_or(10).clamp(1, 10);
    let mut body = rec_service::get_recommendations_for_learner_course(
        &state.pool,
        user_id,
        q.course_id,
        surface,
    )
    .await
    .unwrap_or_else(|_| RecommendationsResponse::degraded_empty());
    body.recommendations.truncate(limit);
    Ok(Json(body))
}

async fn batch_learner_concepts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LearnerConceptsBatchRequest>,
) -> Result<Json<LearnerConceptsBatchResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    if body.user_ids.is_empty() {
        return Err(AppError::invalid_input("userIds must not be empty."));
    }
    if body.user_ids.len() > MAX_BATCH_USER_IDS {
        return Err(AppError::invalid_input(format!(
            "At most {MAX_BATCH_USER_IDS} user ids per request."
        )));
    }
    assert_can_batch_read_learner_states(&state.pool, user.user_id, &body.user_ids).await?;

    let filter = body.concept_ids.as_deref();
    let rows = learner_model::batch_list_states_for_users(
        &state.pool,
        &body.user_ids,
        filter,
        MAX_BATCH_USER_IDS,
    )
    .await
    .map_err(AppError::Db)?;

    let mut states: HashMap<Uuid, Vec<ConceptStateResponse>> = HashMap::new();
    for (uid, row) in rows {
        states
            .entry(uid)
            .or_default()
            .push(ConceptStateResponse::from(row));
    }
    for u in &body.user_ids {
        states.entry(*u).or_default();
    }
    Ok(Json(LearnerConceptsBatchResponse { states }))
}
