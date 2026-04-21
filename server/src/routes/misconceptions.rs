//! Misconception library CRUD, option tagging, and course reports (plan 1.10).

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::enrollment;
use crate::repos::misconceptions as mc_repo;
use crate::repos::rbac;
use crate::repos::question_bank as qb_repo;
use crate::services::misconception;
use crate::services::question_bank;
use crate::state::AppState;

const MISCONCEPTION_SEED_LIBRARY_JSON: &str = include_str!("../../seeds/misconceptions/library.json");

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/misconceptions",
            get(list_misconceptions_handler).post(create_misconception_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/misconceptions/import-seed-library",
            post(import_seed_library_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/misconceptions/{misconception_id}",
            put(update_misconception_handler).delete(delete_misconception_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/misconception-report",
            get(misconception_report_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}/options/{option_id}/misconception",
            put(set_option_misconception_handler),
        )
}

async fn require_course_items_create(state: &AppState, course_code: &str, user_id: Uuid) -> Result<(), AppError> {
    let required = course_grants::course_items_create_permission(course_code);
    assert_permission(&state.pool, user_id, &required).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MisconceptionApiRow {
    pub id: Uuid,
    pub course_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub concept_id: Option<Uuid>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation_url: Option<String>,
    pub locale: String,
    pub is_seed: bool,
}

impl From<mc_repo::MisconceptionRow> for MisconceptionApiRow {
    fn from(r: mc_repo::MisconceptionRow) -> Self {
        MisconceptionApiRow {
            id: r.id,
            course_id: r.course_id,
            concept_id: r.concept_id,
            name: r.name,
            description: r.description,
            remediation_body: r.remediation_body,
            remediation_url: r.remediation_url,
            locale: r.locale,
            is_seed: r.is_seed,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MisconceptionsListQuery {
    #[serde(default)]
    pub concept_id: Option<Uuid>,
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

async fn list_misconceptions_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    Query(q): Query<MisconceptionsListQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<MisconceptionApiRow>>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_course_items_create(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let lim = q.limit.unwrap_or(200);
    let rows = mc_repo::list_for_course(
        &state.pool,
        course_id,
        q.concept_id,
        q.q.as_deref(),
        lim,
    )
    .await
    .map_err(AppError::Db)?;
    Ok(Json(rows.into_iter().map(MisconceptionApiRow::from).collect()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMisconceptionRequest {
    pub name: String,
    #[serde(default)]
    pub concept_id: Option<Uuid>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub remediation_body: Option<String>,
    #[serde(default)]
    pub remediation_url: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
}

async fn create_misconception_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateMisconceptionRequest>,
) -> Result<Json<MisconceptionApiRow>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_course_items_create(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::invalid_input("name is required."));
    }
    let loc = req.locale.as_deref().unwrap_or("en").trim();
    if loc.is_empty() {
        return Err(AppError::invalid_input("locale cannot be empty."));
    }
    let id = mc_repo::insert(
        &state.pool,
        course_id,
        req.concept_id,
        name,
        req.description.as_deref(),
        req.remediation_body.as_deref(),
        req.remediation_url.as_deref(),
        loc,
        false,
    )
    .await
    .map_err(AppError::Db)?;
    let row = mc_repo::get_by_id(&state.pool, course_id, id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(MisconceptionApiRow::from(row)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedLibraryFileEntry {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    remediation_body: Option<String>,
    #[serde(default)]
    remediation_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportSeedLibraryRequest {
    #[serde(default)]
    replace_existing_seeds: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportSeedLibraryResponse {
    imported: usize,
    skipped: usize,
}

async fn import_seed_library_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<ImportSeedLibraryRequest>,
) -> Result<Json<ImportSeedLibraryResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_course_items_create(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let entries: Vec<SeedLibraryFileEntry> = serde_json::from_str(MISCONCEPTION_SEED_LIBRARY_JSON).map_err(|_| {
        AppError::invalid_input("Built-in misconception seed library is invalid JSON (server bug).")
    })?;

    if req.replace_existing_seeds {
        mc_repo::delete_seed_misconceptions_for_course(&state.pool, course_id)
            .await
            .map_err(AppError::Db)?;
    }

    let mut imported = 0usize;
    let mut skipped = 0usize;
    for e in entries {
        let name = e.name.trim();
        if name.is_empty() {
            skipped += 1;
            continue;
        }
        if !req.replace_existing_seeds
            && mc_repo::misconception_name_exists_ci(&state.pool, course_id, name)
                .await
                .map_err(AppError::Db)?
        {
            skipped += 1;
            continue;
        }
        let desc = e
            .description
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let url = e
            .remediation_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        mc_repo::insert(
            &state.pool,
            course_id,
            None,
            name,
            desc,
            e.remediation_body.as_deref(),
            url,
            "en",
            true,
        )
        .await
        .map_err(AppError::Db)?;
        imported += 1;
    }

    Ok(Json(ImportSeedLibraryResponse { imported, skipped }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMisconceptionRequest {
    pub name: String,
    #[serde(default)]
    pub concept_id: Option<Uuid>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub remediation_body: Option<String>,
    #[serde(default)]
    pub remediation_url: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
}

async fn update_misconception_handler(
    State(state): State<AppState>,
    Path((course_code, misconception_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpdateMisconceptionRequest>,
) -> Result<Json<MisconceptionApiRow>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_course_items_create(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::invalid_input("name is required."));
    }
    let loc = req.locale.as_deref().unwrap_or("en").trim();
    if loc.is_empty() {
        return Err(AppError::invalid_input("locale cannot be empty."));
    }
    let ok = mc_repo::update(
        &state.pool,
        course_id,
        misconception_id,
        req.concept_id,
        name,
        req.description.as_deref(),
        req.remediation_body.as_deref(),
        req.remediation_url.as_deref(),
        loc,
    )
    .await
    .map_err(AppError::Db)?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let row = mc_repo::get_by_id(&state.pool, course_id, misconception_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(MisconceptionApiRow::from(row)))
}

async fn delete_misconception_handler(
    State(state): State<AppState>,
    Path((course_code, misconception_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let is_global_admin =
        rbac::user_has_permission(&state.pool, user.user_id, "global:app:rbac:manage").await?;
    if !is_global_admin {
        require_course_items_create(&state, &course_code, user.user_id).await?;
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let ok = mc_repo::delete_for_course(&state.pool, course_id, misconception_id)
        .await
        .map_err(AppError::Db)?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MisconceptionReportResponse {
    pub misconceptions: Vec<mc_repo::MisconceptionReportRow>,
}

async fn misconception_report_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<MisconceptionReportResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_course_items_create(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let rows = mc_repo::misconception_report(&state.pool, course_id)
        .await
        .map_err(AppError::Db)?;
    Ok(Json(MisconceptionReportResponse {
        misconceptions: rows,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetOptionMisconceptionRequest {
    #[serde(default)]
    pub misconception_id: Option<Uuid>,
}

async fn set_option_misconception_handler(
    State(state): State<AppState>,
    Path((course_code, question_id, option_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<SetOptionMisconceptionRequest>,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_course_items_create(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let ent = qb_repo::get_question(&state.pool, course_id, question_id)
        .await?
        .ok_or(AppError::NotFound)?;

    let authored_ids = question_bank::authored_choice_uuids_from_entity(&ent);
    if !authored_ids.is_empty() {
        let idx = ent
            .correct_answer
            .as_ref()
            .and_then(|v| v.get("correctChoiceIndex"))
            .and_then(|x| x.as_u64())
            .map(|n| n as usize);
        misconception::assert_option_not_correct_answer(idx, &authored_ids, option_id)?;
    }

    let mut tx = state.pool.begin().await?;
    if let Some(mid) = req.misconception_id {
        let m = mc_repo::get_by_id(&state.pool, course_id, mid)
            .await
            .map_err(AppError::Db)?
            .ok_or_else(|| AppError::invalid_input("Unknown misconception id for this course."))?;
        let _ = m;
        mc_repo::upsert_option_tag(&mut *tx, question_id, option_id, mid)
            .await
            .map_err(AppError::Db)?;
    } else {
        mc_repo::delete_option_tag(&mut *tx, question_id, option_id)
            .await
            .map_err(AppError::Db)?;
    }
    tx.commit().await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
