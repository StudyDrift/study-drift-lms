//! Diagnostic placement HTTP API (plan 1.7).

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::models::course_module_quiz::AdaptiveQuizGeneratedQuestion;
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::diagnostic as diagnostic_repo;
use crate::repos::enrollment;
use crate::services::adaptive_path as adaptive_path_service;
use crate::services::diagnostic as diagnostic_service;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/enrollments/{enrollment_id}/diagnostic",
            get(enrollment_diagnostic_get),
        )
        .route(
            "/api/v1/enrollments/{enrollment_id}/diagnostic/start",
            post(enrollment_diagnostic_start_post),
        )
        .route(
            "/api/v1/enrollments/{enrollment_id}/diagnostic/bypass",
            post(enrollment_diagnostic_bypass_post),
        )
        .route(
            "/api/v1/diagnostic-attempts/{attempt_id}/respond",
            post(diagnostic_attempt_respond_post),
        )
        .route(
            "/api/v1/courses/{course_code}/diagnostic-results",
            get(course_diagnostic_results_get),
        )
        .route(
            "/api/v1/courses/{course_code}/diagnostic-config",
            get(course_diagnostic_config_get).put(course_diagnostic_config_put),
        )
}

async fn require_course_access(state: &AppState, course_code: &str, user_id: Uuid) -> Result<(), AppError> {
    let ok = enrollment::user_has_access(&state.pool, course_code, user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(())
}

async fn assert_can_read_enrollment_diagnostic(
    pool: &sqlx::PgPool,
    caller_id: Uuid,
    en: &enrollment::EnrollmentById,
) -> Result<(), AppError> {
    if en.user_id == caller_id {
        return Ok(());
    }
    let required = course_grants::course_enrollments_read_permission(&en.course_code);
    assert_permission(pool, caller_id, &required).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentDiagnosticResponse {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attempt: Option<DiagnosticAttemptPublic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticAttemptPublic {
    id: Uuid,
    started_at: chrono::DateTime<chrono::Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
    bypassed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    placement_summary: Option<JsonValue>,
}

async fn enrollment_diagnostic_get(
    State(state): State<AppState>,
    Path(enrollment_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<EnrollmentDiagnosticResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let Some(en) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    assert_can_read_enrollment_diagnostic(&state.pool, user.user_id, &en).await?;

    let course_row = course::get_by_id(&state.pool, en.course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let diag = diagnostic_repo::get_diagnostic_for_course(&state.pool, en.course_id).await?;
    let global = diagnostic_service::diagnostic_assessments_globally_enabled();
    let active = diagnostic_service::diagnostic_active_for_course(
        global,
        course_row.diagnostic_assessments_enabled,
        diag.is_some(),
    );
    if !active {
        return Ok(Json(EnrollmentDiagnosticResponse {
            status: "off".into(),
            diagnostic_id: None,
            attempt: None,
        }));
    }
    let Some(d) = diag else {
        return Ok(Json(EnrollmentDiagnosticResponse {
            status: "not_configured".into(),
            diagnostic_id: None,
            attempt: None,
        }));
    };

    let latest = diagnostic_repo::latest_attempt_for_enrollment(&state.pool, d.id, enrollment_id).await?;
    let attempt = latest.map(|a| DiagnosticAttemptPublic {
        id: a.id,
        started_at: a.started_at,
        completed_at: a.completed_at,
        bypassed: a.bypassed,
        placement_summary: a.placement_summary,
    });

    let status = if let Some(ref a) = attempt {
        if a.completed_at.is_none() {
            "in_progress"
        } else if a.bypassed {
            "bypassed"
        } else {
            "completed"
        }
    } else {
        "pending"
    }
    .to_string();

    Ok(Json(EnrollmentDiagnosticResponse {
        status,
        diagnostic_id: Some(d.id),
        attempt,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticStartResponse {
    attempt_id: Uuid,
    first_question: AdaptiveQuizGeneratedQuestion,
}

async fn enrollment_diagnostic_start_post(
    State(state): State<AppState>,
    Path(enrollment_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<DiagnosticStartResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let Some(en) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    if en.user_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    let course_row = course::get_by_id(&state.pool, en.course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let diag = diagnostic_repo::get_diagnostic_for_course(&state.pool, en.course_id).await?;
    let global = diagnostic_service::diagnostic_assessments_globally_enabled();
    let active = diagnostic_service::diagnostic_active_for_course(
        global,
        course_row.diagnostic_assessments_enabled,
        diag.is_some(),
    );
    if !active {
        return Err(AppError::invalid_input("Diagnostic assessments are not available for this course."));
    }
    let (attempt_id, q) =
        diagnostic_service::start_or_resume_diagnostic(&state.pool, en.course_id, enrollment_id, user.user_id)
            .await?;
    Ok(Json(DiagnosticStartResponse {
        attempt_id,
        first_question: q,
    }))
}

async fn enrollment_diagnostic_bypass_post(
    State(state): State<AppState>,
    Path(enrollment_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let Some(en) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    if en.user_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    diagnostic_service::bypass_diagnostic_for_enrollment(&state.pool, en.course_id, enrollment_id, user.user_id)
        .await?;
    Ok(axum::http::StatusCode::OK)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticRespondHttpBody {
    question_id: Uuid,
    choice_index: usize,
    #[serde(default)]
    response_ms: Option<i32>,
}

async fn diagnostic_attempt_respond_post(
    State(state): State<AppState>,
    Path(attempt_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<DiagnosticRespondHttpBody>,
) -> Result<Json<diagnostic_service::DiagnosticRespondResult>, AppError> {
    let user = auth_user(&state, &headers)?;
    let Some(att) = diagnostic_repo::get_attempt_by_id(&state.pool, attempt_id).await? else {
        return Err(AppError::NotFound);
    };
    let Some(en) = enrollment::get_enrollment_by_id(&state.pool, att.enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    if en.user_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    let body = diagnostic_service::DiagnosticRespondBody {
        question_id: body.question_id,
        choice_index: body.choice_index,
        response_ms: body.response_ms,
    };
    let out = diagnostic_service::respond_diagnostic_attempt(
        &state.pool,
        en.course_id,
        user.user_id,
        attempt_id,
        body,
    )
    .await?;
    Ok(Json(out))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticResultsResponse {
    students: Vec<DiagnosticStudentResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticStudentResult {
    enrollment_id: Uuid,
    user_id: Uuid,
    display_name: Option<String>,
    email: Option<String>,
    attempt_id: Option<Uuid>,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
    bypassed: Option<bool>,
    theta_summary: Option<JsonValue>,
    placement_summary: Option<JsonValue>,
}

async fn course_diagnostic_results_get(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<DiagnosticResultsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_enrollments_read_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let course_row = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    let Some(d) = diagnostic_repo::get_diagnostic_for_course(&state.pool, course_row.id).await? else {
        return Err(AppError::NotFound);
    };
    let rows = diagnostic_repo::list_diagnostic_results_for_course(&state.pool, d.id, course_row.id).await?;
    let students = rows
        .into_iter()
        .map(|r| DiagnosticStudentResult {
            enrollment_id: r.enrollment_id,
            user_id: r.user_id,
            display_name: r.display_name,
            email: r.email,
            attempt_id: r.attempt_id,
            completed_at: r.completed_at,
            bypassed: r.bypassed,
            theta_summary: r.theta_summary,
            placement_summary: r.placement_summary,
        })
        .collect();
    Ok(Json(DiagnosticResultsResponse { students }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CourseDiagnosticConfigResponse {
    diagnostic: Option<diagnostic_repo::CourseDiagnosticRow>,
}

async fn course_diagnostic_config_get(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseDiagnosticConfigResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let course_row = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    let diagnostic = diagnostic_repo::get_diagnostic_for_course(&state.pool, course_row.id).await?;
    Ok(Json(CourseDiagnosticConfigResponse { diagnostic }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutDiagnosticConfigBody {
    concept_ids: Vec<Uuid>,
    #[serde(default = "default_max_items")]
    max_items: i32,
    #[serde(default = "default_stopping")]
    stopping_rule: String,
    #[serde(default = "default_se")]
    se_threshold: f64,
    #[serde(default = "default_retake")]
    retake_policy: String,
    #[serde(default)]
    placement_rules: JsonValue,
    theta_cut_scores: Option<JsonValue>,
}

fn default_max_items() -> i32 {
    20
}
fn default_stopping() -> String {
    "both".into()
}
fn default_se() -> f64 {
    0.3
}
fn default_retake() -> String {
    "once".into()
}

async fn course_diagnostic_config_put(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PutDiagnosticConfigBody>,
) -> Result<Json<diagnostic_repo::CourseDiagnosticRow>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let course_row = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    if !course_row.question_bank_enabled {
        return Err(AppError::invalid_input(
            "Enable the question bank for this course before configuring a diagnostic.",
        ));
    }
    adaptive_path_service::validate_concepts_for_course(&state.pool, course_row.id, &req.concept_ids).await?;

    let stopping = match req.stopping_rule.as_str() {
        "max_items" | "se_threshold" | "both" => req.stopping_rule.as_str(),
        _ => {
            return Err(AppError::invalid_input(
                "stoppingRule must be max_items, se_threshold, or both.",
            ));
        }
    };
    if !matches!(req.retake_policy.as_str(), "once" | "per_term" | "always") {
        return Err(AppError::invalid_input("retakePolicy must be once, per_term, or always."));
    }
    let max_items = req.max_items.clamp(3, 60);
    let se = req.se_threshold.clamp(0.05, 1.0);

    let row = diagnostic_repo::upsert_course_diagnostic(
        &state.pool,
        course_row.id,
        &req.concept_ids,
        max_items,
        stopping,
        se,
        req.retake_policy.as_str(),
        &req.placement_rules,
        req.theta_cut_scores.as_ref(),
    )
    .await
    .map_err(AppError::Db)?;
    Ok(Json(row))
}
