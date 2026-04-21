use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::models::course_module_survey::{
    validate_anonymity_mode, validate_questions, CreateCourseSurveyRequest, SubmitSurveyResponse,
    SubmitSurveyResponseRequest, SurveyResponse, SurveyResultsResponse, UpdateSurveyRequest,
};
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::course_module_surveys;
use crate::repos::course_structure;
use crate::repos::enrollment;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/surveys",
            get(list_course_surveys_handler).post(create_course_survey_handler),
        )
        .route(
            "/api/v1/surveys/{id}",
            get(get_survey_handler).put(update_survey_handler),
        )
        .route(
            "/api/v1/surveys/{id}/respond",
            post(submit_survey_response_handler),
        )
        .route(
            "/api/v1/surveys/{id}/results",
            get(get_survey_results_handler),
        )
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

async fn list_course_surveys_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Vec<SurveyResponse>>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    Ok(Json(
        course_module_surveys::list_for_course(&state.pool, course_id).await?,
    ))
}

async fn create_course_survey_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateCourseSurveyRequest>,
) -> Result<Json<SurveyResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::invalid_input("Survey title is required."));
    }
    let mode = if req.anonymity_mode.trim().is_empty() {
        "identified"
    } else {
        req.anonymity_mode.trim()
    };
    if !validate_anonymity_mode(mode) {
        return Err(AppError::invalid_input(
            "anonymityMode must be identified, anonymous, or pseudo_anonymous.",
        ));
    }
    if let (Some(opens_at), Some(closes_at)) = (req.opens_at, req.closes_at) {
        if opens_at > closes_at {
            return Err(AppError::invalid_input("opensAt must be before closesAt."));
        }
    }
    validate_questions(&req.questions).map_err(AppError::invalid_input)?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let row =
        course_structure::insert_survey_under_module(&state.pool, course_id, req.module_id, title)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => AppError::NotFound,
                _ => e.into(),
            })?;
    let saved = course_module_surveys::update_survey(
        &state.pool,
        row.id,
        None,
        Some(req.description.trim()),
        Some(mode),
        req.opens_at,
        req.closes_at,
        Some(&req.questions),
    )
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(saved))
}

async fn get_survey_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<SurveyResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let survey = course_module_surveys::get_for_item(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    let course_code = course::get_course_code_by_id(&state.pool, survey.course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit =
        crate::repos::rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::survey_visible_to_student(
            &state.pool,
            survey.course_id,
            id,
            user.user_id,
            chrono::Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }
    Ok(Json(survey))
}

async fn update_survey_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<UpdateSurveyRequest>,
) -> Result<Json<SurveyResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let current = course_module_surveys::get_for_item(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    let course_code = course::get_course_code_by_id(&state.pool, current.course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    if let Some(title) = &req.title {
        if title.trim().is_empty() {
            return Err(AppError::invalid_input("Survey title is required."));
        }
    }
    if let Some(mode) = &req.anonymity_mode {
        if !validate_anonymity_mode(mode.trim()) {
            return Err(AppError::invalid_input(
                "anonymityMode must be identified, anonymous, or pseudo_anonymous.",
            ));
        }
    }
    if let Some(questions) = &req.questions {
        validate_questions(questions).map_err(AppError::invalid_input)?;
    }
    if let (Some(opens_at), Some(closes_at)) = (req.opens_at, req.closes_at) {
        if opens_at > closes_at {
            return Err(AppError::invalid_input("opensAt must be before closesAt."));
        }
    }

    let updated = course_module_surveys::update_survey(
        &state.pool,
        id,
        req.title.as_deref().map(str::trim),
        req.description.as_deref().map(str::trim),
        req.anonymity_mode.as_deref().map(str::trim),
        req.opens_at,
        req.closes_at,
        req.questions.as_deref(),
    )
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(updated))
}

async fn submit_survey_response_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<SubmitSurveyResponseRequest>,
) -> Result<Json<SubmitSurveyResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let survey = course_module_surveys::get_for_item(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    let course_code = course::get_course_code_by_id(&state.pool, survey.course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let visible = course_structure::survey_visible_to_student(
        &state.pool,
        survey.course_id,
        id,
        user.user_id,
        chrono::Utc::now(),
    )
    .await?;
    if !visible {
        return Err(AppError::Forbidden);
    }

    let (known_survey, already_submitted) =
        course_module_surveys::submit_response(&state.pool, id, user.user_id, &req.answers).await?;
    if !known_survey {
        return Err(AppError::NotFound);
    }
    Ok(Json(SubmitSurveyResponse {
        submitted: true,
        already_submitted: already_submitted.then_some(true),
    }))
}

async fn get_survey_results_handler(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<SurveyResultsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let survey = course_module_surveys::get_for_item(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    let course_code = course::get_course_code_by_id(&state.pool, survey.course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let (response_count, questions) =
        course_module_surveys::aggregate_results(&state.pool, id).await?;
    Ok(Json(SurveyResultsResponse {
        response_count,
        questions,
    }))
}
