use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, put},
    Json, Router,
};
use chrono::{NaiveDate, Utc};
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::models::accommodations::{
    AccommodationSummaryPublic, AccommodationUserSearchHit, AccommodationUserSearchQuery,
    AccommodationUserSearchResponse, CreateStudentAccommodationRequest, MyAccommodationEntry,
    MyAccommodationsResponse, StudentAccommodationApi, UpdateStudentAccommodationRequest,
    MANAGE_ACCOMMODATIONS_PERM,
};
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::enrollment;
use crate::repos::student_accommodations;
use crate::repos::user;
use crate::services::accommodations;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/accommodations/users",
            get(search_accommodation_users_handler),
        )
        .route(
            "/api/v1/enrollments/{enrollment_id}/accommodation-summary",
            get(enrollment_accommodation_summary_handler),
        )
        .route(
            "/api/v1/users/{user_id}/accommodations",
            get(list_user_accommodations_handler).post(create_user_accommodation_handler),
        )
        .route(
            "/api/v1/users/{user_id}/accommodations/{accommodation_id}",
            put(update_user_accommodation_handler).delete(delete_user_accommodation_handler),
        )
        .route("/api/v1/me/accommodations", get(me_accommodations_handler))
}

async fn require_manage_accommodations(pool: &sqlx::PgPool, user_id: Uuid) -> Result<(), AppError> {
    assert_permission(pool, user_id, MANAGE_ACCOMMODATIONS_PERM).await
}

async fn search_accommodation_users_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AccommodationUserSearchQuery>,
) -> Result<Json<AccommodationUserSearchResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_manage_accommodations(&state.pool, user.user_id).await?;

    let q = query.q.trim();
    if q.is_empty() {
        return Err(AppError::InvalidInput(
            "Query parameter \"q\" is required (email, name, sid, or user id).".into(),
        ));
    }
    if q.len() < 2 && Uuid::parse_str(q).is_err() {
        return Err(AppError::InvalidInput(
            "Enter at least 2 characters, or paste the learner's full user id.".into(),
        ));
    }

    let rows = user::search_users_for_accommodation_lookup(&state.pool, q).await?;
    let users = rows
        .into_iter()
        .map(|r| AccommodationUserSearchHit {
            id: r.id,
            email: r.email,
            display_name: r.display_name,
            first_name: r.first_name,
            last_name: r.last_name,
            sid: r.sid,
        })
        .collect();

    Ok(Json(AccommodationUserSearchResponse { users }))
}

fn row_active_on_date(
    effective_from: Option<NaiveDate>,
    effective_until: Option<NaiveDate>,
    today: NaiveDate,
) -> bool {
    if let Some(from) = effective_from {
        if today < from {
            return false;
        }
    }
    if let Some(until) = effective_until {
        if today > until {
            return false;
        }
    }
    true
}

fn api_row(
    r: &student_accommodations::StudentAccommodationRow,
    course_code: Option<String>,
) -> StudentAccommodationApi {
    StudentAccommodationApi {
        id: r.id,
        user_id: r.user_id,
        course_id: r.course_id,
        course_code,
        time_multiplier: r.time_multiplier,
        extra_attempts: r.extra_attempts,
        hints_always_enabled: r.hints_always_enabled,
        reduced_distraction_mode: r.reduced_distraction_mode,
        alternative_format: r.alternative_format.clone(),
        effective_from: r.effective_from,
        effective_until: r.effective_until,
        created_by: r.created_by,
        updated_by: r.updated_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

async fn enrollment_accommodation_summary_handler(
    State(state): State<AppState>,
    Path(enrollment_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<AccommodationSummaryPublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    let Some(en) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    let required = course_grants::course_enrollments_read_permission(&en.course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let eff = accommodations::resolve_effective_or_default(&state.pool, en.user_id, en.course_id).await;
    let flags = accommodations::instructor_flag_labels(&eff);
    let has_accommodation = !flags.is_empty();
    Ok(Json(AccommodationSummaryPublic {
        has_accommodation,
        flags,
    }))
}

async fn list_user_accommodations_handler(
    State(state): State<AppState>,
    Path(target_user_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Vec<StudentAccommodationApi>>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_manage_accommodations(&state.pool, user.user_id).await?;

    let rows = student_accommodations::list_for_user_with_course(&state.pool, target_user_id).await?;
    let out = rows
        .into_iter()
        .map(|r| api_row(&r.row, r.course_code))
        .collect();
    Ok(Json(out))
}

async fn create_user_accommodation_handler(
    State(state): State<AppState>,
    Path(target_user_id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<CreateStudentAccommodationRequest>,
) -> Result<Json<StudentAccommodationApi>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_manage_accommodations(&state.pool, user.user_id).await?;

    let tm = req.time_multiplier;
    if !(1.0..=99.99).contains(&tm) {
        return Err(AppError::InvalidInput(
            "timeMultiplier must be between 1.0 and 99.99.".into(),
        ));
    }
    if !(0..=500).contains(&req.extra_attempts) {
        return Err(AppError::InvalidInput(
            "extraAttempts must be between 0 and 500.".into(),
        ));
    }
    let extra = req.extra_attempts.max(0);

    let course_id = match req.course_code.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(code) => {
            let Some(cid) = course::get_id_by_course_code(&state.pool, code).await? else {
                return Err(AppError::InvalidInput("Unknown courseCode.".into()));
            };
            Some(cid)
        }
        None => None,
    };

    let row = student_accommodations::insert_row(
        &state.pool,
        target_user_id,
        course_id,
        tm,
        extra,
        req.hints_always_enabled,
        req.reduced_distraction_mode,
        req.alternative_format.as_deref(),
        req.effective_from,
        req.effective_until,
        user.user_id,
    )
    .await?;

    let cc = if let Some(cid) = row.course_id {
        course::get_course_code_by_id(&state.pool, cid).await?
    } else {
        None
    };

    Ok(Json(api_row(&row, cc)))
}

async fn update_user_accommodation_handler(
    State(state): State<AppState>,
    Path((target_user_id, accommodation_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpdateStudentAccommodationRequest>,
) -> Result<Json<StudentAccommodationApi>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_manage_accommodations(&state.pool, user.user_id).await?;

    if !(1.0..=99.99).contains(&req.time_multiplier) {
        return Err(AppError::InvalidInput(
            "timeMultiplier must be between 1.0 and 99.99.".into(),
        ));
    }
    if !(0..=500).contains(&req.extra_attempts) {
        return Err(AppError::InvalidInput(
            "extraAttempts must be between 0 and 500.".into(),
        ));
    }

    let Some(updated) = student_accommodations::update_row(
        &state.pool,
        accommodation_id,
        target_user_id,
        req.time_multiplier,
        req.extra_attempts,
        req.hints_always_enabled,
        req.reduced_distraction_mode,
        req.alternative_format.as_deref(),
        req.effective_from,
        req.effective_until,
        user.user_id,
    )
    .await?
    else {
        return Err(AppError::NotFound);
    };

    let cc = if let Some(cid) = updated.course_id {
        course::get_course_code_by_id(&state.pool, cid).await?
    } else {
        None
    };

    Ok(Json(api_row(&updated, cc)))
}

async fn delete_user_accommodation_handler(
    State(state): State<AppState>,
    Path((target_user_id, accommodation_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<axum::http::StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_manage_accommodations(&state.pool, user.user_id).await?;
    let ok = student_accommodations::delete_row(&state.pool, accommodation_id, target_user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(axum::http::StatusCode::NO_CONTENT)
}

async fn me_accommodations_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MyAccommodationsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let rows = student_accommodations::list_for_user_with_course(&state.pool, user.user_id).await?;
    let today = Utc::now().date_naive();
    let accommodations: Vec<MyAccommodationEntry> = rows
        .into_iter()
        .filter(|r| row_active_on_date(r.row.effective_from, r.row.effective_until, today))
        .map(|r| MyAccommodationEntry {
            course_code: r.course_code,
            has_extended_time: r.row.time_multiplier > 1.000_001,
            has_extra_attempts: r.row.extra_attempts > 0,
            hints_always_available: r.row.hints_always_enabled,
            reduced_distraction_recommended: r.row.reduced_distraction_mode,
            effective_from: r.row.effective_from,
            effective_until: r.row.effective_until,
        })
        .collect();
    Ok(Json(MyAccommodationsResponse { accommodations }))
}
