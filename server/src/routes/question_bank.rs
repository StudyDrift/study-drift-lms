use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::models::question_bank::{
    AddPoolMembersRequest, BulkImportQuestionsResponse, CreateQuestionHintRequest,
    CreateQuestionPoolRequest, CreateQuestionRequest, HintAnalyticsLevel, HintAnalyticsResponse,
    IccPoint, QuestionBankRowResponse, QuestionHintAuthorResponse, QuestionIrtStatsResponse,
    QuestionOptionMisconceptionTagApi, QuestionPoolResponse, QuestionVersionSummaryResponse,
    RestoreQuestionVersionRequest, SetQuizDeliveryRefsRequest, UpdateQuestionHintRequest,
    UpdateQuestionRequest, UpsertWorkedExampleRequest,
};
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::course_module_quizzes;
use crate::repos::enrollment;
use crate::repos::hints as hints_repo;
use crate::repos::misconceptions as mc_repo;
use crate::repos::question_bank as qb_repo;
use crate::services::irt;
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
            "/api/v1/courses/{course_code}/questions/{question_id}/irt-stats",
            get(get_question_irt_stats_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}/hints",
            get(list_question_hints_handler).post(create_question_hint_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}/hints/{hint_id}",
            put(update_question_hint_handler).delete(delete_question_hint_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}/worked-example",
            put(upsert_worked_example_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}/hint-analytics",
            get(question_hint_analytics_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}/versions",
            get(list_question_versions_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}/versions/{version_number}",
            get(get_question_version_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/questions/{question_id}/versions/{version_number}/restore",
            post(restore_question_version_handler),
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

async fn require_instructor(
    state: &AppState,
    course_code: &str,
    user_id: Uuid,
) -> Result<(), AppError> {
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
        irt_c: e.irt_c,
        irt_status: e.irt_status,
        irt_sample_n: Some(e.irt_sample_n),
        irt_calibrated_at: e.irt_calibrated_at,
        created_by: e.created_by,
        created_at: e.created_at,
        updated_at: e.updated_at,
        version_number: e.version_number,
        is_published: e.is_published,
        shuffle_choices_override: e.shuffle_choices_override,
        srs_eligible: e.srs_eligible,
        option_misconception_tags: None,
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
    if !matches!(t, "draft" | "active" | "retired" | "needs_review") {
        return Err(AppError::invalid_input(
            "status must be draft, active, retired, or needs_review.",
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
        return Err(AppError::invalid_input("stem is required."));
    }
    let qt = req.question_type.trim();
    if qt.is_empty() {
        return Err(AppError::invalid_input("questionType is required."));
    }
    let status = normalize_create_status(req.status)?;
    let points = req.points.unwrap_or(1.0).max(0.0);
    let meta = req.metadata.unwrap_or_else(|| json!({}));
    let shared = req.shared.unwrap_or(false);
    let options_norm = question_bank::normalize_question_options_json(req.options.as_ref());

    let mut tx = state.pool.begin().await?;
    let id = qb_repo::insert_question(
        &mut tx,
        course_id,
        qt,
        stem,
        options_norm.as_ref(),
        req.correct_answer.as_ref(),
        req.explanation.as_deref(),
        points,
        &status,
        shared,
        "authored",
        &meta,
        Some(user.user_id),
        req.shuffle_choices_override,
        req.srs_eligible.unwrap_or(false),
    )
    .await?;
    let now = Utc::now();
    let inserted = qb_repo::QuestionEntity {
        id,
        course_id,
        question_type: qt.to_string(),
        stem: stem.to_string(),
        options: options_norm.clone(),
        correct_answer: req.correct_answer.clone(),
        explanation: req.explanation.clone(),
        points,
        status: status.clone(),
        shared,
        source: "authored".to_string(),
        metadata: meta.clone(),
        irt_a: None,
        irt_b: None,
        irt_c: None,
        irt_status: "uncalibrated".to_string(),
        irt_sample_n: 0,
        irt_calibrated_at: None,
        created_by: Some(user.user_id),
        created_at: now,
        updated_at: now,
        version_number: 1,
        is_published: status == "active",
        shuffle_choices_override: req.shuffle_choices_override,
        srs_eligible: req.srs_eligible.unwrap_or(false),
    };
    qb_repo::insert_question_version_snapshot(
        &mut *tx,
        &inserted,
        Some("Initial version"),
        Some(&json!({ "initialVersion": true })),
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
    let tags = mc_repo::list_option_tags_for_question(&state.pool, question_id)
        .await
        .map_err(AppError::Db)?;
    let mut resp = entity_to_api(row);
    resp.option_misconception_tags = Some(
        tags.into_iter()
            .map(|t| QuestionOptionMisconceptionTagApi {
                option_id: t.option_id,
                misconception_id: t.misconception_id,
            })
            .collect(),
    );
    Ok(Json(resp))
}

async fn get_question_irt_stats_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<QuestionIrtStatsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let e = qb_repo::get_question(&state.pool, course_id, question_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let observed = qb_repo::count_scored_responses_for_question(&state.pool, course_id, question_id)
        .await? as i32;
    let sample_n = observed.max(e.irt_sample_n);
    let a = e.irt_a.unwrap_or(1.0);
    let b = e.irt_b.unwrap_or(0.0);
    let c = e.irt_c.unwrap_or(0.0);
    let icc: Vec<IccPoint> = irt::icc_curve_points(a, b, c)
        .into_iter()
        .map(|(theta, p_correct)| IccPoint { theta, p_correct })
        .collect();
    Ok(Json(QuestionIrtStatsResponse {
        a: e.irt_a,
        b: e.irt_b,
        c: e.irt_c,
        status: e.irt_status,
        sample_n,
        calibrated_at: e.irt_calibrated_at,
        icc,
    }))
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
        return Err(AppError::invalid_input("stem cannot be empty."));
    }
    let options = match req.options {
        None => cur.options.clone(),
        Some(None) => None,
        Some(Some(v)) => Some(question_bank::merge_question_options_on_write(
            &v,
            cur.options.as_ref(),
        )),
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
    if !matches!(
        status.as_str(),
        "draft" | "active" | "retired" | "needs_review"
    ) {
        return Err(AppError::invalid_input("Invalid status."));
    }
    let shared = req.shared.unwrap_or(cur.shared);
    let mut meta = cur.metadata.clone();
    if let Some(m) = req.metadata {
        meta = m;
    }
    let shuffle_choices_override = match &req.shuffle_choices_override {
        None => cur.shuffle_choices_override,
        Some(None) => None,
        Some(Some(b)) => Some(*b),
    };
    let srs_eligible = req.srs_eligible.unwrap_or(cur.srs_eligible);

    let mut tx = state.pool.begin().await?;
    let next_version = qb_repo::update_question_row_with_versioning(
        &mut *tx,
        &cur,
        &question_type,
        &stem,
        options.as_ref(),
        correct_answer.as_ref(),
        explanation.as_deref(),
        points,
        &status,
        shared,
        &meta,
        shuffle_choices_override,
        srs_eligible,
    )
    .await?;
    let mut snapshot_row = cur.clone();
    snapshot_row.question_type = question_type.clone();
    snapshot_row.stem = stem.clone();
    snapshot_row.options = options.clone();
    snapshot_row.correct_answer = correct_answer.clone();
    snapshot_row.explanation = explanation.clone();
    snapshot_row.points = points;
    snapshot_row.status = status.clone();
    snapshot_row.shared = shared;
    snapshot_row.metadata = meta.clone();
    snapshot_row.shuffle_choices_override = shuffle_choices_override;
    snapshot_row.srs_eligible = srs_eligible;
    snapshot_row.version_number = next_version;
    if status == "active" {
        snapshot_row.is_published = true;
    }
    snapshot_row.updated_at = Utc::now();
    let changed_fields = json!({
        "questionTypeChanged": question_type != cur.question_type,
        "stemChanged": stem != cur.stem,
        "optionsChanged": options != cur.options,
        "correctAnswerChanged": correct_answer != cur.correct_answer,
        "explanationChanged": explanation != cur.explanation,
        "pointsChanged": (points - cur.points).abs() > f64::EPSILON,
        "statusChanged": status != cur.status,
        "srsEligibleChanged": srs_eligible != cur.srs_eligible,
    });
    if next_version > cur.version_number || snapshot_row.version_number == 1 {
        qb_repo::insert_question_version_snapshot(
            &mut *tx,
            &snapshot_row,
            req.change_note.as_deref(),
            Some(&changed_fields),
            Some(user.user_id),
        )
        .await?;
    }
    tx.commit().await?;
    let row = qb_repo::get_question(&state.pool, course_id, question_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(entity_to_api(row)))
}

async fn list_question_versions_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
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
    let versions = qb_repo::list_question_versions(&state.pool, course_id, question_id).await?;
    let payload: Vec<QuestionVersionSummaryResponse> = versions
        .into_iter()
        .map(|v| QuestionVersionSummaryResponse {
            version_number: v.version_number,
            change_note: v.change_note,
            change_summary: v.change_summary,
            created_by: v.created_by,
            created_at: v.created_at,
        })
        .collect();
    Ok(Json(json!({ "versions": payload })))
}

async fn get_question_version_handler(
    State(state): State<AppState>,
    Path((course_code, question_id, version_number)): Path<(String, Uuid, i32)>,
    headers: HeaderMap,
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
    let snapshot =
        qb_repo::get_question_version_snapshot(&state.pool, course_id, question_id, version_number)
            .await?
            .ok_or(AppError::NotFound)?;
    Ok(Json(snapshot))
}

async fn restore_question_version_handler(
    State(state): State<AppState>,
    Path((course_code, question_id, version_number)): Path<(String, Uuid, i32)>,
    headers: HeaderMap,
    Json(req): Json<RestoreQuestionVersionRequest>,
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
    let snapshot =
        qb_repo::get_question_version_snapshot(&state.pool, course_id, question_id, version_number)
            .await?
            .ok_or(AppError::NotFound)?;
    let cur = qb_repo::get_question(&state.pool, course_id, question_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let question_type = snapshot
        .get("question_type")
        .and_then(|v| v.as_str())
        .unwrap_or("mc_single");
    let stem = snapshot
        .get("stem")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let options = snapshot.get("options").filter(|v| !v.is_null());
    let correct_answer = snapshot.get("correct_answer").filter(|v| !v.is_null());
    let explanation = snapshot.get("explanation").and_then(|v| v.as_str());
    let points = snapshot
        .get("points")
        .and_then(|v| v.as_f64())
        .unwrap_or(cur.points);
    let status = snapshot
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("draft");
    let shared = snapshot
        .get("shared")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let metadata = snapshot
        .get("metadata")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let shuffle_choices_override = match snapshot.get("shuffle_choices_override") {
        None => cur.shuffle_choices_override,
        Some(v) if v.is_null() => None,
        Some(v) => v.as_bool(),
    };
    let srs_eligible = snapshot
        .get("srs_eligible")
        .and_then(|v| v.as_bool())
        .unwrap_or(cur.srs_eligible);
    let mut tx = state.pool.begin().await?;
    let mut restore_base = cur.clone();
    restore_base.is_published = true;
    let new_version = qb_repo::update_question_row_with_versioning(
        &mut *tx,
        &restore_base,
        question_type,
        stem,
        options,
        correct_answer,
        explanation,
        points,
        status,
        shared,
        &metadata,
        shuffle_choices_override,
        srs_eligible,
    )
    .await?;
    let mut snapshot_row = cur.clone();
    snapshot_row.question_type = question_type.to_string();
    snapshot_row.stem = stem.to_string();
    snapshot_row.options = options.cloned();
    snapshot_row.correct_answer = correct_answer.cloned();
    snapshot_row.explanation = explanation.map(ToString::to_string);
    snapshot_row.points = points;
    snapshot_row.status = status.to_string();
    snapshot_row.shared = shared;
    snapshot_row.metadata = metadata.clone();
    snapshot_row.shuffle_choices_override = shuffle_choices_override;
    snapshot_row.srs_eligible = srs_eligible;
    snapshot_row.version_number = new_version;
    if status == "active" {
        snapshot_row.is_published = true;
    }
    snapshot_row.updated_at = Utc::now();
    let note = req
        .change_note
        .as_deref()
        .or(Some("Restored from prior version"));
    let summary = json!({ "restoredFromVersion": version_number });
    qb_repo::insert_question_version_snapshot(
        &mut *tx,
        &snapshot_row,
        note,
        Some(&summary),
        Some(user.user_id),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({ "newVersionNumber": snapshot_row.version_number }),
    ))
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
        return Err(AppError::invalid_input("name is required."));
    }
    let row =
        qb_repo::insert_pool(&state.pool, course_id, name, req.description.as_deref()).await?;
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
        return Err(AppError::invalid_input("Maximum 500 questions per import."));
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
            req.shuffle_choices_override,
            req.srs_eligible.unwrap_or(false),
        )
        .await?;
        let now = Utc::now();
        let inserted = qb_repo::QuestionEntity {
            id,
            course_id,
            question_type: qt.to_string(),
            stem: stem.to_string(),
            options: req.options.clone(),
            correct_answer: req.correct_answer.clone(),
            explanation: req.explanation.clone(),
            points,
            status: status.clone(),
            shared,
            source: "authored".to_string(),
            metadata: meta.clone(),
            irt_a: None,
            irt_b: None,
            irt_c: None,
            irt_status: "uncalibrated".to_string(),
            irt_sample_n: 0,
            irt_calibrated_at: None,
            created_by: Some(user.user_id),
            created_at: now,
            updated_at: now,
            version_number: 1,
            is_published: status == "active",
            shuffle_choices_override: req.shuffle_choices_override,
            srs_eligible: req.srs_eligible.unwrap_or(false),
        };
        qb_repo::insert_question_version_snapshot(
            &mut *tx,
            &inserted,
            Some("Initial version"),
            Some(&json!({ "initialVersion": true })),
            Some(user.user_id),
        )
        .await?;
        n += 1;
    }
    tx.commit().await?;
    Ok(Json(BulkImportQuestionsResponse { imported_count: n }))
}

fn hint_row_to_api(h: hints_repo::QuestionHintRow) -> QuestionHintAuthorResponse {
    QuestionHintAuthorResponse {
        id: h.id,
        question_id: h.question_id,
        level: h.level as i32,
        body: h.body,
        media_url: h.media_url,
        locale: h.locale,
        penalty_pct: h.penalty_pct,
        created_at: h.created_at,
    }
}

async fn list_question_hints_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<Vec<QuestionHintAuthorResponse>>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    qb_repo::get_question(&state.pool, course_id, question_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let rows = hints_repo::list_hints_for_question_locale(&state.pool, question_id, "en")
        .await
        .map_err(AppError::Db)?;
    Ok(Json(rows.into_iter().map(hint_row_to_api).collect()))
}

async fn create_question_hint_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateQuestionHintRequest>,
) -> Result<Json<QuestionHintAuthorResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    qb_repo::get_question(&state.pool, course_id, question_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let level = req.level;
    if !(1..=5).contains(&level) {
        return Err(AppError::invalid_input("level must be between 1 and 5."));
    }
    let body = req.body.trim();
    if body.is_empty() {
        return Err(AppError::invalid_input("body is required."));
    }
    let locale = req.locale.as_deref().unwrap_or("en").trim();
    if locale.is_empty() {
        return Err(AppError::invalid_input("locale is invalid."));
    }
    let penalty = req.penalty_pct.unwrap_or(0.0).clamp(0.0, 100.0);
    let row = hints_repo::insert_hint(
        &state.pool,
        question_id,
        level as i16,
        body,
        req.media_url.as_deref(),
        locale,
        penalty,
    )
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db) = e {
            if db.code().as_deref() == Some("23505") {
                return AppError::invalid_input(
                    "A hint already exists for this level and locale on this question.",
                );
            }
        }
        AppError::Db(e)
    })?;
    Ok(Json(hint_row_to_api(row)))
}

async fn update_question_hint_handler(
    State(state): State<AppState>,
    Path((course_code, question_id, hint_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpdateQuestionHintRequest>,
) -> Result<Json<QuestionHintAuthorResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    qb_repo::get_question(&state.pool, course_id, question_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let level = req.level;
    if !(1..=5).contains(&level) {
        return Err(AppError::invalid_input("level must be between 1 and 5."));
    }
    let body = req.body.trim();
    if body.is_empty() {
        return Err(AppError::invalid_input("body is required."));
    }
    let locale = req.locale.as_deref().unwrap_or("en").trim();
    let penalty = req.penalty_pct.unwrap_or(0.0).clamp(0.0, 100.0);
    let row = hints_repo::update_hint(
        &state.pool,
        hint_id,
        question_id,
        level as i16,
        body,
        req.media_url.as_deref(),
        locale,
        penalty,
    )
    .await
    .map_err(AppError::Db)?
    .ok_or(AppError::NotFound)?;
    Ok(Json(hint_row_to_api(row)))
}

async fn delete_question_hint_handler(
    State(state): State<AppState>,
    Path((course_code, question_id, hint_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    qb_repo::get_question(&state.pool, course_id, question_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let deleted = hints_repo::delete_hint(&state.pool, hint_id, question_id)
        .await
        .map_err(AppError::Db)?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn upsert_worked_example_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpsertWorkedExampleRequest>,
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
    qb_repo::get_question(&state.pool, course_id, question_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let steps = serde_json::Value::Array(req.steps);
    hints_repo::upsert_worked_example(
        &state.pool,
        question_id,
        req.title.as_deref(),
        req.body.as_deref(),
        &steps,
    )
    .await
    .map_err(AppError::Db)?;
    Ok(Json(json!({ "ok": true })))
}

async fn question_hint_analytics_handler(
    State(state): State<AppState>,
    Path((course_code, question_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<HintAnalyticsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_instructor(&state, &course_code, user.user_id).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    qb_repo::get_question(&state.pool, course_id, question_id)
        .await
        .map_err(AppError::Db)?
        .ok_or(AppError::NotFound)?;
    let qid = question_id.to_string();
    let total = hints_repo::hint_distinct_students_for_question(&state.pool, &qid)
        .await
        .map_err(AppError::Db)?;
    let rows = hints_repo::hint_analytics_for_question(&state.pool, &qid)
        .await
        .map_err(AppError::Db)?;
    let levels: Vec<HintAnalyticsLevel> = rows
        .into_iter()
        .map(|r| {
            let pct = if total > 0 {
                (100.0 * r.distinct_students as f64 / total as f64).clamp(0.0, 100.0)
            } else {
                0.0
            };
            HintAnalyticsLevel {
                level: r.level as i32,
                request_count: r.request_count,
                pct_users: pct,
            }
        })
        .collect();
    Ok(Json(HintAnalyticsResponse { levels }))
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
            let pid = req
                .pool_id
                .ok_or_else(|| AppError::invalid_input("poolId is required."))?;
            let sn = req
                .sample_n
                .ok_or_else(|| AppError::invalid_input("sampleN is required."))?;
            question_bank::set_quiz_delivery_pool_only(&state.pool, course_id, item_id, pid, sn)
                .await?;
        }
        _ => {
            return Err(AppError::invalid_input(
                "mode must be \"json\" or \"pool\".",
            ));
        }
    }

    Ok(Json(json!({ "ok": true })))
}
