//! Learner knowledge state API (`/api/v1/learners/...`).

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::repos::learner_model;
use crate::services::learner_state::{
    assert_can_batch_read_learner_states, assert_can_read_learner_state, ConceptStateResponse,
    LearnerConceptsBatchResponse, LearnerConceptsListResponse, LearnerStateService,
    DEFAULT_LEARNER_STATE_SERVICE,
};
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
        .route("/api/v1/learners/concepts/batch", post(batch_learner_concepts))
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
