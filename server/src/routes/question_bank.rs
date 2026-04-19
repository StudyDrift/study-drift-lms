use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::models::question_bank::{
    AddPoolMembersRequest, BulkImportQuestionsResponse, CreateQuestionPoolRequest, CreateQuestionRequest,
    QuestionBankRowResponse, QuestionPoolResponse, SetQuizDeliveryRefsRequest, UpdateQuestionRequest,
};
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::course_module_quizzes;
use crate::repos::enrollment;
use crate::repos::question_bank as qb_repo;
use crate::services::question_bank;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/questions",
            get(list_questions_handler).post(create_question_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/bulk-import",
            post(bulk_import_questions_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}",
            get(get_question_handler)
                .put(update_question_handler)
                .delete(delete_question_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/question-pools",
            get(list_pools_handler).post(create_pool_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/question-pools/{pool_id}/members",
            post(add_pool_members_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/question-pools/{pool_id}/members/{question_id}",
            delete(remove_pool_member_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/question-bank-delivery",
            post(set_quiz_delivery_handler),
        )
}

async fn require_instructor(state: &AppState, course_code: &str, user_id: Uuid) -> Result<(), AppError> {
    let required = course_grants::course_items_create_permission(course_code);
    assert_permission(&state.pool, user_id, &required).await
}

fn entity_to_api(e: qb_repo::QuestionEntity) -> QuestionBankRowResponse {
    QuestionBankRowResponse {
        id: e.id,
        course_id: e.course_id,
        question_type: e.question_type,
        stem: e.stem,
        options: e.options,
        correct_answer: e.correct_answer,
        explanation: e.explanation,
        points: e.points,
        status: e.status,
        shared: e.shared,
        source: e.source,
        metadata: e.metadata,
        irt_a: e.irt_a,
        irt_b: e.irt_b,
        irt_status: e.irt_status,
        created_by: e.created_by,
        created_at: e.created_at,
        updated_at: e.updated_at,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuestionSearchQuery {
    #[serde(default)]
    q: Option<String>,
    #[serde(default, rename = "type")]
    question_type: Option<String>,
    #[serde(default)]
    concept_id: Option<Uuid>,
    #[serde(default)]
    difficulty: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    after_created_at: Option<DateTime<Utc>>,
    #[serde(default)]
    after_id: Option<Uuid>,
}

async fn list_questions_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    Query(q): Query<QuestionSearchQuery>,
    headers: HeaderMap,
) -> Result<Json<Vec<QuestionBankRowResponse>>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let rows = question_bank::search_questions(
        &state.pool,
        course_id,
        q.q.as_deref(),
        q.question_type.as_deref(),
        q.concept_id,
        q.difficulty.as_deref(),
        q.status.as_deref(),
        limit,
        q.after_created_at,
        q.after_id,
    )
    .await?;
    Ok(Json(rows.into_iter().map(entity_to_api).collect()))
}

fn normalize_create_status(s: Option<String>) -> Result<String, AppError> {
    let v = s.unwrap_or_else(|| "draft".into());
    let t = v.trim();
    if !matches!(t, "draft" | "active" | "retired") {
        return Err(AppError::InvalidInput(
            "status must be draft, active, or retired.".into(),
        ));
    }
    Ok(t.to_string())
}

async fn create_question_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateQuestionRequest>,
) -> Result<Json<QuestionBankRowResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let stem = req.stem.trim();
    if stem.is_empty() {
        return Err(AppError::InvalidInput("stem is required.".into()));
    }
    let qt = req.question_type.trim();
    if qt.is_empty() {
        return Err(AppError::InvalidInput("questionType is required.".into()));
    }
    let status = normalize_create_status(req.status)?;
    let points = req.points.unwrap_or(1.0).max(0.0);
    let meta = req.metadata.unwrap_or_else(|| json!({}));
    let shared = req.shared.unwrap_or(false);

    let mut tx = state.pool.begin().await?;
    let id = qb_repo::insert_question(
        &mut tx,
        course_id,
        qt,
        stem,
        req.options.as_ref(),
        req.correct_answer.as_ref(),
        req.explanation.as_deref(),
        points,
        &status,
        shared,
        "authored",
        &meta,
        Some(user.user_id),
    )
    .await?;
    tx.commit().await?;
    let row = qb_repo::get_question(&state.pool, course_id, id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(entity_to_api(row)))
}

async fn get_question_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<QuestionBankRowResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let row = qb_repo::get_question(&state.pool, course_id, question_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(entity_to_api(row)))
}

async fn update_question_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpdateQuestionRequest>,
) -> Result<Json<QuestionBankRowResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let cur = qb_repo::get_question(&state.pool, course_id, question_id)
        .await?
        .ok_or(AppError::NotFound)?;

    let question_type = req
        .question_type
        .as_deref()
        .unwrap_or(&cur.question_type)
        .trim()
        .to_string();
    let stem = req.stem.as_deref().unwrap_or(&cur.stem).trim().to_string();
    if stem.is_empty() {
        return Err(AppError::InvalidInput("stem cannot be empty.".into()));
    }
    let options = match req.options {
        None => cur.options.clone(),
        Some(None) => None,
        Some(Some(v)) => Some(v),
    };
    let correct_answer = match req.correct_answer {
        None => cur.correct_answer.clone(),
        Some(None) => None,
        Some(Some(v)) => Some(v),
    };
    let explanation = match req.explanation {
        None => cur.explanation.clone(),
        Some(None) => None,
        Some(Some(v)) => Some(v),
    };
    let points = req.points.unwrap_or(cur.points).max(0.0);
    let status = req
        .status
        .as_deref()
        .map(|s| s.trim().to_string())
        .unwrap_or(cur.status.clone());
    if !matches!(status.as_str(), "draft" | "active" | "retired") {
        return Err(AppError::InvalidInput("Invalid status.".into()));
    }
    let shared = req.shared.unwrap_or(cur.shared);
    let mut meta = cur.metadata.clone();
    if let Some(m) = req.metadata {
        meta = m;
    }

    let updated = qb_repo::update_question_row(
        &state.pool,
        course_id,
        question_id,
        &question_type,
        &stem,
        options.as_ref(),
        correct_answer.as_ref(),
        explanation.as_deref(),
        points,
        &status,
        shared,
        &meta,
    )
    .await?;
    if !updated {
        return Err(AppError::NotFound);
    }
    let row = qb_repo::get_question(&state.pool, course_id, question_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(entity_to_api(row)))
}

async fn delete_question_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let deleted = qb_repo::delete_question(&state.pool, course_id, question_id).await?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn list_pools_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Vec<QuestionPoolResponse>>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let rows = qb_repo::list_pools(&state.pool, course_id).await?;
    Ok(Json(
        rows.into_iter()
            .map(|p| QuestionPoolResponse {
                id: p.id,
                course_id: p.course_id,
                name: p.name,
                description: p.description,
                created_at: p.created_at,
            })
            .collect(),
    ))
}

async fn create_pool_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateQuestionPoolRequest>,
) -> Result<Json<QuestionPoolResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("name is required.".into()));
    }
    let row = qb_repo::insert_pool(&state.pool, course_id, name, req.description.as_deref()).await?;
    Ok(Json(QuestionPoolResponse {
        id: row.id,
        course_id: row.course_id,
        name: row.name,
        description: row.description,
        created_at: row.created_at,
    }))
}

async fn add_pool_members_handler(
    State(state): State<AppState>,
    Path((course_code, pool_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<AddPoolMembersRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    qb_repo::get_pool(&state.pool, course_id, pool_id)
        .await?
        .ok_or(AppError::NotFound)?;

    let mut added = 0usize;
    for qid in &req.question_ids {
        if qb_repo::add_pool_member(&state.pool, pool_id, course_id, *qid).await? {
            added += 1;
        }
    }
    Ok(Json(json!({ "added": added })))
}

async fn remove_pool_member_handler(
    State(state): State<AppState>,
    Path((course_code, pool_id, question_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let removed = qb_repo::remove_pool_member(&state.pool, pool_id, course_id, question_id).await?;
    if !removed {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn bulk_import_questions_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(items): Json<Vec<CreateQuestionRequest>>,
) -> Result<Json<BulkImportQuestionsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    if items.len() > 500 {
        return Err(AppError::InvalidInput("Maximum 500 questions per import.".into()));
    }

    let mut tx = state.pool.begin().await?;
    let mut n = 0usize;
    for req in items {
        let stem = req.stem.trim();
        if stem.is_empty() {
            continue;
        }
        let qt = req.question_type.trim();
        if qt.is_empty() {
            continue;
        }
        let status = normalize_create_status(req.status)?;
        let points = req.points.unwrap_or(1.0).max(0.0);
        let meta = req.metadata.unwrap_or_else(|| json!({}));
        let shared = req.shared.unwrap_or(false);
        qb_repo::insert_question(
            &mut tx,
            course_id,
            qt,
            stem,
            req.options.as_ref(),
            req.correct_answer.as_ref(),
            req.explanation.as_deref(),
            points,
            &status,
            shared,
            "authored",
            &meta,
            Some(user.user_id),
        )
        .await?;
        n += 1;
    }
    tx.commit().await?;
    Ok(Json(BulkImportQuestionsResponse { imported_count: n }))
}

async fn set_quiz_delivery_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<SetQuizDeliveryRefsRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let _ = course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id)
        .await?
        .ok_or(AppError::NotFound)?;

    let mode = req.mode.trim().to_ascii_lowercase();
    match mode.as_str() {
        "json" => question_bank::clear_quiz_delivery_refs(&state.pool, item_id).await?,
        "pool" => {
            let pid = req.pool_id.ok_or_else(|| AppError::InvalidInput("poolId is required.".into()))?;
            let sn = req
                .sample_n
                .ok_or_else(|| AppError::InvalidInput("sampleN is required.".into()))?;
            question_bank::set_quiz_delivery_pool_only(&state.pool, course_id, item_id, pid, sn).await?;
        }
        _ => {
            return Err(AppError::InvalidInput(
                "mode must be \"json\" or \"pool\".".into(),
            ));
        }
    }

    Ok(Json(json!({ "ok": true })))
}
