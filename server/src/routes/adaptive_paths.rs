use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, put},
    Json, Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::models::adaptive_path::{EnrollmentNextResponse, PutEnrollmentPathOverrideRequest};
use crate::repos::adaptive_path as adaptive_path_repo;
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::course_structure;
use crate::repos::enrollment;
use crate::repos::learner_model;
use crate::services::competency_gating;
use crate::services::adaptive_path as adaptive_path_service;
use crate::services::learner_state;
use crate::state::AppState;
use chrono::Utc;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/enrollments/{enrollment_id}/next",
            get(enrollment_next_handler),
        )
        .route(
            "/api/v1/enrollments/{enrollment_id}/path-override",
            put(enrollment_path_override_put_handler)
                .delete(enrollment_path_override_delete_handler),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrollmentNextQuery {
    #[serde(default)]
    from_item_id: Option<Uuid>,
}

async fn require_course_access(
    state: &AppState,
    course_code: &str,
    user_id: Uuid,
) -> Result<(), AppError> {
    let ok = enrollment::user_has_access(&state.pool, course_code, user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(())
}

async fn assert_can_read_enrollment_next(
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

async fn assert_can_manage_path_override(
    pool: &sqlx::PgPool,
    caller_id: Uuid,
    course_code: &str,
) -> Result<(), AppError> {
    let required = course_grants::course_item_create_permission(course_code);
    assert_permission(pool, caller_id, &required).await
}

async fn enrollment_next_handler(
    State(state): State<AppState>,
    Path(enrollment_id): Path<Uuid>,
    headers: HeaderMap,
    Query(q): Query<EnrollmentNextQuery>,
) -> Result<Json<EnrollmentNextResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let Some(en) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    assert_can_read_enrollment_next(&state.pool, user.user_id, &en).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &en.course_code).await? else {
        return Err(AppError::NotFound);
    };

    let global_on = adaptive_path_service::adaptive_paths_globally_enabled();
    let adaptive_on = adaptive_path_service::adaptive_paths_active_for_course(
        global_on,
        course_row.adaptive_paths_enabled,
    );

    let mut rows = course_structure::list_for_course(&state.pool, course_row.id).await?;
    rows = course_structure::filter_archived_items_from_structure_list(rows);
    let is_staff =
        enrollment::user_is_course_staff(&state.pool, &en.course_code, user.user_id).await?;
    if !is_staff {
        rows = course_structure::filter_structure_for_student_view(rows, Utc::now());
        rows = competency_gating::filter_structure_rows_for_competency_student(
            &state.pool,
            course_row.id,
            course_row.course_type.as_str(),
            en.user_id,
            rows,
        )
        .await?;
    }

    let rules = adaptive_path_repo::list_rules_for_course(&state.pool, course_row.id).await?;
    let ov = adaptive_path_repo::get_path_override(&state.pool, enrollment_id).await?;

    let mut mastery_failed = false;
    let mut mastery: HashMap<Uuid, f64> = HashMap::new();
    if adaptive_on && ov.is_none() {
        let mut concept_ids: Vec<Uuid> = rules.iter().flat_map(|r| r.concept_ids.clone()).collect();
        concept_ids.sort_unstable();
        concept_ids.dedup();
        if !concept_ids.is_empty() && learner_state::learner_model_enabled() {
            match learner_model::list_states_for_user(&state.pool, en.user_id, Some(&concept_ids))
                .await
            {
                Ok(states) => {
                    for s in states {
                        mastery.insert(s.concept_id, s.mastery_effective);
                    }
                }
                Err(_) => {
                    mastery_failed = true;
                }
            }
        } else if !concept_ids.is_empty() && !learner_state::learner_model_enabled() {
            mastery_failed = true;
        }
    }

    let override_seq = ov.as_ref().map(|o| o.item_sequence.as_slice());
    let Some(res) = adaptive_path_service::resolve_next_item(
        &rows,
        q.from_item_id,
        &mastery,
        &rules,
        override_seq,
        adaptive_on,
        mastery_failed,
    ) else {
        return Err(AppError::invalid_input("No further items in this path."));
    };

    let item_row = course_structure::get_item_row(&state.pool, course_row.id, res.to_item_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_row.id, item_row)
            .await?;

    let _ = adaptive_path_repo::insert_path_event(
        &state.pool,
        enrollment_id,
        q.from_item_id,
        res.to_item_id,
        res.rule_id,
        override_seq.is_some(),
        res.fallback,
    )
    .await;

    Ok(Json(EnrollmentNextResponse {
        item,
        skip_reason: res.skip_reason,
        skip_reason_key: res.skip_reason_key,
        fallback: res.fallback,
    }))
}

async fn enrollment_path_override_put_handler(
    State(state): State<AppState>,
    Path(enrollment_id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<PutEnrollmentPathOverrideRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let Some(en) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    assert_can_manage_path_override(&state.pool, user.user_id, &en.course_code).await?;
    require_course_access(&state, &en.course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &en.course_code).await? else {
        return Err(AppError::NotFound);
    };
    let mut rows = course_structure::list_for_course(&state.pool, course_row.id).await?;
    rows = course_structure::filter_archived_items_from_structure_list(rows);
    if !adaptive_path_service::validate_override_sequence(&rows, &req.item_sequence) {
        return Err(AppError::invalid_input(
            "itemSequence must be a non-empty list of navigable structure item ids in this course.",
        ));
    }

    adaptive_path_repo::upsert_path_override(
        &state.pool,
        enrollment_id,
        &req.item_sequence,
        user.user_id,
    )
    .await
    .map_err(AppError::Db)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn enrollment_path_override_delete_handler(
    State(state): State<AppState>,
    Path(enrollment_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let Some(en) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    assert_can_manage_path_override(&state.pool, user.user_id, &en.course_code).await?;
    require_course_access(&state, &en.course_code, user.user_id).await?;

    let ok = adaptive_path_repo::delete_path_override(&state.pool, enrollment_id)
        .await
        .map_err(AppError::Db)?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
