use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::repos::concepts::{
    self, ConceptJson, GraphBundle, ListConceptsQuery,
};
use crate::services::concept_graph;
use crate::state::AppState;

const PERM_CONCEPTS_MANAGE: &str = "global:app:concepts:manage";
const PERM_ADMIN_RBAC: &str = "global:app:rbac:manage";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/concepts", get(list_concepts).post(create_concept))
        .route("/api/v1/concepts/search", get(search_concepts))
        .route(
            "/api/v1/concepts/{id}",
            get(get_concept).put(update_concept).delete(delete_concept),
        )
        .route(
            "/api/v1/concepts/{id}/prerequisites",
            post(add_prerequisite),
        )
        .route(
            "/api/v1/concepts/{id}/prerequisites/{prerequisite_id}",
            delete(remove_prerequisite),
        )
        .route("/api/v1/concepts/{id}/ancestors", get(get_ancestors))
        .route("/api/v1/concepts/{id}/descendants", get(get_descendants))
        .route(
            "/api/v1/concepts/question-tags",
            post(add_question_tag).delete(remove_question_tag_delete),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConceptsParams {
    pub parent: Option<String>,
    pub bloom: Option<String>,
    pub q: Option<String>,
}

async fn list_concepts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListConceptsParams>,
) -> Result<Json<Vec<ConceptJson>>, AppError> {
    let _ = auth_user(&state, &headers)?;
    let rows = concepts::list_concepts(
        &state.pool,
        ListConceptsQuery {
            parent_slug: q.parent.as_deref(),
            bloom: q.bloom.as_deref(),
            q: q.q.as_deref(),
        },
    )
    .await
    .map_err(AppError::Db)?;
    Ok(Json(rows.into_iter().map(ConceptJson::from).collect()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConceptsParams {
    pub q: String,
}

async fn search_concepts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SearchConceptsParams>,
) -> Result<Json<Vec<ConceptJson>>, AppError> {
    let _ = auth_user(&state, &headers)?;
    let rows = concepts::search_concepts_fts(&state.pool, &q.q, 100)
        .await
        .map_err(AppError::Db)?;
    Ok(Json(rows.into_iter().map(ConceptJson::from).collect()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConceptBody {
    pub name: String,
    pub description: Option<String>,
    pub bloom_level: Option<String>,
    pub parent_concept_id: Option<Uuid>,
}

async fn create_concept(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateConceptBody>,
) -> Result<(axum::http::StatusCode, Json<ConceptJson>), AppError> {
    let user = auth_user(&state, &headers)?;
    assert_permission(&state.pool, user.user_id, PERM_CONCEPTS_MANAGE).await?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::invalid_input("name is required."));
    }
    let c = concept_graph::create_concept(
        &state.pool,
        name,
        body.description,
        body.bloom_level,
        body.parent_concept_id,
    )
    .await?;
    Ok((axum::http::StatusCode::CREATED, Json(c)))
}

async fn get_concept(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<ConceptJson>, AppError> {
    let _ = auth_user(&state, &headers)?;
    let row = concepts::get_by_id(&state.pool, id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(ConceptJson::from(row)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConceptBody {
    pub name: String,
    pub description: Option<String>,
    pub bloom_level: Option<String>,
    pub parent_concept_id: Option<Option<Uuid>>,
}

async fn update_concept(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateConceptBody>,
) -> Result<Json<ConceptJson>, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_permission(&state.pool, user.user_id, PERM_CONCEPTS_MANAGE).await?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::invalid_input("name is required."));
    }
    let row = concept_graph::update_concept(
        &state.pool,
        id,
        name.to_string(),
        body.description,
        body.bloom_level,
        body.parent_concept_id,
    )
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn delete_concept(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_permission(&state.pool, user.user_id, PERM_ADMIN_RBAC).await?;
    let ok = concepts::delete_concept(&state.pool, id)
        .await
        .map_err(AppError::Db)?;
    if !ok {
        return Err(AppError::NotFound);
    }
    tracing::info!(target: "concept_graph", concept_id = %id, user_id = %user.user_id, "concept_graph.concept_deleted");
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPrerequisiteBody {
    pub prerequisite_id: Uuid,
}

async fn add_prerequisite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<AddPrerequisiteBody>,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_permission(&state.pool, user.user_id, PERM_CONCEPTS_MANAGE).await?;
    concept_graph::add_prerequisite(&state.pool, id, body.prerequisite_id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn remove_prerequisite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, prerequisite_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_permission(&state.pool, user.user_id, PERM_CONCEPTS_MANAGE).await?;
    let ok = concept_graph::delete_prerequisite_edge(&state.pool, id, prerequisite_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn get_ancestors(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<GraphBundle>, AppError> {
    let _ = auth_user(&state, &headers)?;
    let g = concepts::list_ancestors(&state.pool, id)
        .await
        .map_err(AppError::Db)?;
    Ok(Json(g))
}

async fn get_descendants(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<GraphBundle>, AppError> {
    let _ = auth_user(&state, &headers)?;
    let g = concepts::list_descendants(&state.pool, id)
        .await
        .map_err(AppError::Db)?;
    Ok(Json(g))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionTagBody {
    pub question_id: Uuid,
    pub concept_id: Uuid,
}

async fn add_question_tag(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<QuestionTagBody>,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_permission(&state.pool, user.user_id, PERM_CONCEPTS_MANAGE).await?;
    concepts::insert_question_tag(&state.pool, body.concept_id, body.question_id)
        .await
        .map_err(AppError::Db)?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveQuestionTagQuery {
    pub question_id: Uuid,
    pub concept_id: Uuid,
}

async fn remove_question_tag_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<RemoveQuestionTagQuery>,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    assert_permission(&state.pool, user.user_id, PERM_CONCEPTS_MANAGE).await?;
    let ok = concepts::delete_question_tag(&state.pool, q.concept_id, q.question_id)
        .await
        .map_err(AppError::Db)?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}
