use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{auth_user, require_permission};
use crate::models::standards::{StandardCodeApi, StandardsImportResponse};
use crate::repos::standards as standards_repo;
use crate::services::standards as standards_service;
use crate::state::AppState;

const PERM_RBAC_MANAGE: &str = "global:app:rbac:manage";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/standards", get(list_standards_handler))
        .route("/api/v1/standards/search", get(search_standards_handler))
        .route("/api/v1/standards/{id}", get(get_standard_handler))
        .route("/api/v1/admin/standards/import", post(admin_import_handler))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListStandardsQuery {
    pub framework: String,
    #[serde(default)]
    pub grade: Option<String>,
    #[serde(default)]
    pub q: Option<String>,
}

async fn list_standards_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListStandardsQuery>,
) -> Result<Json<Vec<StandardCodeApi>>, AppError> {
    let _ = auth_user(&state, &headers)?;
    let rows = standards_service::list_standards_for_query(
        &state.pool,
        q.framework.trim(),
        q.grade.as_deref().map(str::trim),
        q.q.as_deref(),
    )
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let fw = standards_repo::get_framework_by_id(&state.pool, row.framework_id)
            .await
            .map_err(AppError::Db)?
            .ok_or(AppError::NotFound)?;
        out.push(StandardCodeApi::from_row(row, &fw));
    }
    Ok(Json(out))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStandardsQuery {
    pub q: String,
    pub framework: String,
}

async fn search_standards_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SearchStandardsQuery>,
) -> Result<Json<Vec<StandardCodeApi>>, AppError> {
    let _ = auth_user(&state, &headers)?;
    let rows = standards_service::search_standards(&state.pool, q.framework.trim(), &q.q).await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let fw = standards_repo::get_framework_by_id(&state.pool, row.framework_id)
            .await
            .map_err(AppError::Db)?
            .ok_or(AppError::NotFound)?;
        out.push(StandardCodeApi::from_row(row, &fw));
    }
    Ok(Json(out))
}

async fn get_standard_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<StandardCodeApi>, AppError> {
    let _ = auth_user(&state, &headers)?;
    let row = standards_repo::get_standard_code_by_id(&state.pool, id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let fw = standards_repo::get_framework_by_id(&state.pool, row.framework_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(StandardCodeApi::from_row(row, &fw)))
}

async fn admin_import_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<StandardsImportResponse>), AppError> {
    let actor = require_permission(&state, &headers, PERM_RBAC_MANAGE).await?;
    let outcome = standards_service::import_standards(&state.pool, &body, actor.user_id).await?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(StandardsImportResponse {
            job_id: None,
            framework_code: outcome.framework.code,
            record_count: outcome.record_count,
        }),
    ))
}
