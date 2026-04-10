use crate::error::AppError;
use crate::http_auth::{auth_user, require_permission};
use crate::models::course::{
    CoursePublic, CourseWithViewerResponse, CoursesResponse, CreateCourseRequest, MarkdownThemeCustom,
    SetHeroImageRequest, UpdateCourseRequest, UpdateMarkdownThemeRequest, GRADING_SCALES,
    MARKDOWN_THEME_PRESETS,
};
use crate::models::course_export::{CourseExportV1, CourseImportRequest};
use crate::models::course_grading::{
    CourseGradingSettingsResponse, PatchItemAssignmentGroupRequest, PutCourseGradingSettingsRequest,
};
use crate::models::course_module_content::{
    CreateCourseContentPageRequest, ModuleContentPageResponse, UpdateModuleContentPageRequest,
};
use crate::models::course_module_quiz::{
    validate_adaptive_quiz_settings, validate_quiz_comprehensive_settings, validate_quiz_questions,
    AdaptiveQuizNextRequest, AdaptiveQuizNextResponse, CreateCourseQuizRequest,
    GenerateModuleQuizQuestionsRequest, GenerateModuleQuizQuestionsResponse, ModuleQuizResponse,
    UpdateModuleQuizRequest, ADAPTIVE_SOURCE_KINDS,
};
use crate::models::course_structure::{
    CourseStructureItemResponse, CourseStructureResponse, CreateCourseAssignmentRequest,
    CreateCourseHeadingRequest, CreateCourseModuleRequest, PatchCourseModuleRequest,
    PatchStructureItemRequest, ReorderCourseStructureRequest,
};
use crate::models::course_syllabus::{
    CourseSyllabusResponse, GenerateSyllabusSectionRequest, GenerateSyllabusSectionResponse,
    SyllabusAcceptanceStatusResponse, SyllabusSection, UpdateCourseSyllabusRequest,
};
use crate::models::enrollment::{
    AddEnrollmentsRequest, AddEnrollmentsResponse, CourseEnrollmentsResponse, EnrollSelfAsStudentResponse,
};
use crate::models::rbac::CourseScopedRolesResponse;
use crate::models::settings_ai::{GenerateCourseImageRequest, GenerateCourseImageResponse};
use crate::models::user_audit::PostCourseContextRequest;
use crate::repos::course;
use crate::repos::course_grading;
use crate::repos::course_grading::PutError;
use crate::repos::course_grants;
use crate::repos::course_module_assignments;
use crate::repos::course_module_content;
use crate::repos::course_module_quizzes::{self, QuizSettingsWrite};
use crate::repos::course_structure;
use crate::repos::course_syllabus;
use crate::repos::enrollment;
use crate::repos::syllabus_acceptance;
use crate::repos::rbac;
use crate::repos::user;
use crate::repos::user_ai_settings;
use crate::repos::user_audit;
use crate::services::ai::OpenRouterError;
use crate::services::auth;
use crate::services::adaptive_quiz_ai;
use crate::services::course_export_import;
use crate::services::quiz_generation_ai;
use crate::services::syllabus_section_ai;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

const PERM_COURSE_CREATE: &str = "global:app:course:create";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/courses", get(list_handler).post(create_handler))
        .route(
            "/api/v1/courses/{course_code}/structure/modules",
            post(create_course_module_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/modules/{module_id}",
            patch(patch_course_module_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/modules/{module_id}/headings",
            post(create_module_heading_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/modules/{module_id}/content-pages",
            post(create_module_content_page_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/modules/{module_id}/assignments",
            post(create_module_assignment_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/modules/{module_id}/quizzes",
            post(create_module_quiz_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/content-pages/{item_id}",
            get(module_content_page_get_handler).patch(module_content_page_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}",
            get(module_assignment_get_handler).patch(module_assignment_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}",
            get(module_quiz_get_handler).patch(module_quiz_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/generate-questions",
            post(module_quiz_generate_questions_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/adaptive-next",
            post(module_quiz_adaptive_next_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure",
            get(structure_list_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/reorder",
            post(structure_reorder_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/generate-image",
            post(generate_image_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/hero-image",
            put(set_hero_image_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/course-scoped-roles",
            get(list_course_scoped_roles_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollments/self-as-student",
            post(enroll_self_as_student_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollments",
            get(enrollments_handler).post(add_enrollments_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollments/{enrollment_id}",
            delete(delete_enrollment_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/syllabus",
            get(syllabus_get_handler).patch(syllabus_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/syllabus/acceptance-status",
            get(syllabus_acceptance_status_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/syllabus/accept",
            post(syllabus_accept_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/syllabus/generate-section",
            post(syllabus_generate_section_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/markdown-theme",
            patch(update_markdown_theme_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/course-context",
            post(post_course_context_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/export",
            get(course_export_get_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/import",
            post(course_import_post_handler),
        )
        .route(
            "/api/v1/courses/{course_code}",
            get(get_handler).put(update_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/grading",
            get(grading_get_handler).put(grading_put_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/items/{item_id}/assignment-group",
            patch(structure_item_assignment_group_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/items/{item_id}",
            patch(patch_structure_item_handler).delete(archive_structure_item_handler),
        )
    }

fn parse_email_list(raw: &str) -> Vec<String> {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for part in raw.split(|c: char| matches!(c, ',' | ';' | '\n' | '\r') || c.is_whitespace()) {
        let e = auth::normalize_email(part);
        if e.is_empty() || !e.contains('@') {
            continue;
        }
        if seen.insert(e.clone()) {
            out.push(e);
        }
    }
    out
}

async fn require_course_access(
    state: &AppState,
    course_code: &str,
    user_id: uuid::Uuid,
) -> Result<(), AppError> {
    let ok = enrollment::user_has_access(&state.pool, course_code, user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Records LMS navigation state (`user.user_audit`). Path is named `course-context` to avoid adblock heuristics.
async fn post_course_context_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PostCourseContextRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    match req.kind.as_str() {
        "course_visit" => {
            if req.structure_item_id.is_some() {
                return Err(AppError::InvalidInput(
                    "course_visit must not include structureItemId.".into(),
                ));
            }
            user_audit::insert(&state.pool, user.user_id, course_id, None, "course_visit").await?;
        }
        "content_open" | "content_leave" => {
            let Some(sid) = req.structure_item_id else {
                return Err(AppError::InvalidInput(
                    "content_open and content_leave require structureItemId.".into(),
                ));
            };
            if !user_audit::structure_item_is_course_content_page(&state.pool, course_id, sid)
                .await?
            {
                return Err(AppError::NotFound);
            }
            user_audit::insert(
                &state.pool,
                user.user_id,
                course_id,
                Some(sid),
                req.kind.as_str(),
            )
            .await?;
        }
        _ => {
            return Err(AppError::InvalidInput(
                "Invalid kind. Expected course_visit, content_open, or content_leave.".into(),
            ));
        }
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn require_course_creator(
    state: &AppState,
    course_code: &str,
    user_id: uuid::Uuid,
) -> Result<(), AppError> {
    if !enrollment::user_is_course_creator(&state.pool, course_code, user_id).await? {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

const MAX_SYLLABUS_SECTIONS: usize = 50;
const MAX_SYLLABUS_HEADING_LEN: usize = 512;
const MAX_SYLLABUS_MARKDOWN_LEN: usize = 200_000;
const MAX_MODULE_CONTENT_MARKDOWN_LEN: usize = 200_000;
const MAX_QUIZ_GENERATION_PROMPT_LEN: usize = 8_000;
const MAX_SYLLABUS_SECTION_INSTRUCTIONS_LEN: usize = 8_000;
const MIN_QUIZ_GENERATION_COUNT: i32 = 1;
const MAX_QUIZ_GENERATION_COUNT: i32 = 30;

fn module_quiz_response_for_api(
    item_id: Uuid,
    row: &course_module_quizzes::CourseItemQuizRow,
    show_adaptive_details: bool,
) -> ModuleQuizResponse {
    let requires_quiz_access_code = row
        .quiz_access_code
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let quiz_access_code = show_adaptive_details
        .then(|| row.quiz_access_code.clone())
        .flatten()
        .filter(|s| !s.trim().is_empty());
    ModuleQuizResponse {
        item_id,
        title: row.title.clone(),
        markdown: row.markdown.clone(),
        due_at: row.due_at,
        available_from: row.available_from,
        available_until: row.available_until,
        unlimited_attempts: row.unlimited_attempts,
        max_attempts: row.max_attempts,
        grade_attempt_policy: row.grade_attempt_policy.clone(),
        passing_score_percent: row.passing_score_percent,
        late_submission_policy: row.late_submission_policy.clone(),
        late_penalty_percent: row.late_penalty_percent,
        time_limit_minutes: row.time_limit_minutes,
        timer_pause_when_tab_hidden: row.timer_pause_when_tab_hidden,
        per_question_time_limit_seconds: row.per_question_time_limit_seconds,
        show_score_timing: row.show_score_timing.clone(),
        review_visibility: row.review_visibility.clone(),
        review_when: row.review_when.clone(),
        one_question_at_a_time: row.one_question_at_a_time,
        shuffle_questions: row.shuffle_questions,
        shuffle_choices: row.shuffle_choices,
        allow_back_navigation: row.allow_back_navigation,
        requires_quiz_access_code,
        quiz_access_code,
        adaptive_difficulty: row.adaptive_difficulty.clone(),
        adaptive_topic_balance: row.adaptive_topic_balance,
        adaptive_stop_rule: row.adaptive_stop_rule.clone(),
        random_question_pool_count: row.random_question_pool_count,
        questions: row.questions_json.0.clone(),
        updated_at: row.updated_at,
        is_adaptive: row.is_adaptive,
        adaptive_system_prompt: (show_adaptive_details && row.is_adaptive)
            .then(|| row.adaptive_system_prompt.clone()),
        adaptive_source_item_ids: (show_adaptive_details && row.is_adaptive)
            .then(|| row.adaptive_source_item_ids.0.clone()),
        adaptive_question_count: row.adaptive_question_count,
    }
}

fn quiz_settings_patch_requested(req: &UpdateModuleQuizRequest) -> bool {
    req.available_from.is_some()
        || req.available_until.is_some()
        || req.unlimited_attempts.is_some()
        || req.one_question_at_a_time.is_some()
        || req.max_attempts.is_some()
        || req.grade_attempt_policy.is_some()
        || req.passing_score_percent.is_some()
        || req.late_submission_policy.is_some()
        || req.late_penalty_percent.is_some()
        || req.time_limit_minutes.is_some()
        || req.timer_pause_when_tab_hidden.is_some()
        || req.per_question_time_limit_seconds.is_some()
        || req.show_score_timing.is_some()
        || req.review_visibility.is_some()
        || req.review_when.is_some()
        || req.shuffle_questions.is_some()
        || req.shuffle_choices.is_some()
        || req.allow_back_navigation.is_some()
        || req.quiz_access_code.is_some()
        || req.adaptive_difficulty.is_some()
        || req.adaptive_topic_balance.is_some()
        || req.adaptive_stop_rule.is_some()
        || req.random_question_pool_count.is_some()
}

fn merge_quiz_settings_write(
    cur: &course_module_quizzes::CourseItemQuizRow,
    req: &UpdateModuleQuizRequest,
) -> QuizSettingsWrite {
    let mut s = QuizSettingsWrite::from(cur);
    if let Some(v) = &req.available_from {
        s.available_from = v.clone();
    }
    if let Some(v) = &req.available_until {
        s.available_until = v.clone();
    }
    if let Some(v) = req.unlimited_attempts {
        s.unlimited_attempts = v;
    }
    if let Some(v) = req.max_attempts {
        s.max_attempts = v;
    }
    if let Some(v) = &req.grade_attempt_policy {
        s.grade_attempt_policy = v.trim().to_string();
    }
    if let Some(v) = &req.passing_score_percent {
        s.passing_score_percent = *v;
    }
    if let Some(v) = &req.late_submission_policy {
        s.late_submission_policy = v.trim().to_string();
    }
    if let Some(v) = &req.late_penalty_percent {
        s.late_penalty_percent = *v;
    }
    if let Some(v) = &req.time_limit_minutes {
        s.time_limit_minutes = *v;
    }
    if let Some(v) = req.timer_pause_when_tab_hidden {
        s.timer_pause_when_tab_hidden = v;
    }
    if let Some(v) = &req.per_question_time_limit_seconds {
        s.per_question_time_limit_seconds = *v;
    }
    if let Some(v) = &req.show_score_timing {
        s.show_score_timing = v.trim().to_string();
    }
    if let Some(v) = &req.review_visibility {
        s.review_visibility = v.trim().to_string();
    }
    if let Some(v) = &req.review_when {
        s.review_when = v.trim().to_string();
    }
    if let Some(v) = req.one_question_at_a_time {
        s.one_question_at_a_time = v;
    }
    if let Some(v) = req.shuffle_questions {
        s.shuffle_questions = v;
    }
    if let Some(v) = req.shuffle_choices {
        s.shuffle_choices = v;
    }
    if let Some(v) = req.allow_back_navigation {
        s.allow_back_navigation = v;
    }
    if let Some(v) = &req.quiz_access_code {
        s.quiz_access_code = v
            .as_ref()
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty());
    }
    if let Some(v) = &req.adaptive_difficulty {
        s.adaptive_difficulty = v.trim().to_string();
    }
    if let Some(v) = req.adaptive_topic_balance {
        s.adaptive_topic_balance = v;
    }
    if let Some(v) = &req.adaptive_stop_rule {
        s.adaptive_stop_rule = v.trim().to_string();
    }
    if let Some(v) = &req.random_question_pool_count {
        s.random_question_pool_count = *v;
    }
    s
}

fn validate_syllabus_sections(sections: &[SyllabusSection]) -> Result<(), AppError> {
    if sections.len() > MAX_SYLLABUS_SECTIONS {
        return Err(AppError::InvalidInput(format!(
            "Too many sections (max {MAX_SYLLABUS_SECTIONS})."
        )));
    }
    for s in sections {
        if s.id.trim().is_empty() {
            return Err(AppError::InvalidInput("Each section needs an id.".into()));
        }
        if s.heading.len() > MAX_SYLLABUS_HEADING_LEN {
            return Err(AppError::InvalidInput(
                "Section heading is too long.".into(),
            ));
        }
        if s.markdown.len() > MAX_SYLLABUS_MARKDOWN_LEN {
            return Err(AppError::InvalidInput(
                "Section content is too long.".into(),
            ));
        }
    }
    Ok(())
}

async fn syllabus_acceptance_pending_for_user(
    pool: &PgPool,
    course_code: &str,
    course_id: Uuid,
    user_id: Uuid,
    require: bool,
) -> Result<bool, AppError> {
    if !require {
        return Ok(false);
    }
    let required_perm = course_grants::course_item_create_permission(course_code);
    if rbac::user_has_permission(pool, user_id, &required_perm).await? {
        return Ok(false);
    }
    Ok(!syllabus_acceptance::has_accepted(pool, user_id, course_id).await?)
}

async fn syllabus_get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseSyllabusResponse>, AppError> {
    use chrono::Utc;

    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = course_syllabus::get_for_course(&state.pool, course_id).await?;
    let (sections, updated_at, require) = match row {
        Some((s, t, r)) => (s, t, r),
        None => (Vec::new(), Utc::now(), false),
    };
    let syllabus_acceptance_pending = syllabus_acceptance_pending_for_user(
        &state.pool,
        &course_code,
        course_id,
        user.user_id,
        require,
    )
    .await?;
    Ok(Json(CourseSyllabusResponse {
        sections,
        updated_at,
        require_syllabus_acceptance: require,
        syllabus_acceptance_pending,
    }))
}

async fn syllabus_acceptance_status_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<SyllabusAcceptanceStatusResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let require = course_syllabus::get_for_course(&state.pool, course_id)
        .await?
        .map(|(_, _, r)| r)
        .unwrap_or(false);

    let has_accepted_syllabus = if !require {
        true
    } else {
        let required_perm = course_grants::course_item_create_permission(&course_code);
        if rbac::user_has_permission(&state.pool, user.user_id, &required_perm).await? {
            true
        } else {
            syllabus_acceptance::has_accepted(&state.pool, user.user_id, course_id).await?
        }
    };

    Ok(Json(SyllabusAcceptanceStatusResponse {
        require_syllabus_acceptance: require,
        has_accepted_syllabus,
    }))
}

async fn syllabus_accept_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let require = course_syllabus::get_for_course(&state.pool, course_id)
        .await?
        .map(|(_, _, r)| r)
        .unwrap_or(false);

    if !require {
        return Ok(StatusCode::NO_CONTENT);
    }

    syllabus_acceptance::record(&state.pool, user.user_id, course_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn syllabus_generate_section_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<GenerateSyllabusSectionRequest>,
) -> Result<Json<GenerateSyllabusSectionResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let instructions = req.instructions.trim();
    if instructions.is_empty() {
        return Err(AppError::InvalidInput("Instructions are required.".into()));
    }
    if instructions.len() > MAX_SYLLABUS_SECTION_INSTRUCTIONS_LEN {
        return Err(AppError::InvalidInput(format!(
            "Instructions are too long (max {MAX_SYLLABUS_SECTION_INSTRUCTIONS_LEN} characters)."
        )));
    }

    let client = state
        .open_router
        .as_ref()
        .ok_or(AppError::AiNotConfigured)?;

    let Some(_course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let model = user_ai_settings::get_course_setup_model_id(&state.pool, user.user_id).await?;

    let markdown = syllabus_section_ai::generate_section_markdown(
        &state.pool,
        client.as_ref(),
        &model,
        instructions,
        &req.section_heading,
        &req.existing_markdown,
    )
    .await?;

    if markdown.len() > MAX_SYLLABUS_MARKDOWN_LEN {
        return Err(AppError::AiGenerationFailed(
            "Generated content is too long for a section. Try narrower instructions.".into(),
        ));
    }

    Ok(Json(GenerateSyllabusSectionResponse { markdown }))
}

async fn syllabus_patch_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<UpdateCourseSyllabusRequest>,
) -> Result<Json<CourseSyllabusResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    validate_syllabus_sections(&req.sections)?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let updated_at = course_syllabus::upsert_syllabus(
        &state.pool,
        course_id,
        &req.sections,
        req.require_syllabus_acceptance,
    )
    .await?;

    let syllabus_acceptance_pending = syllabus_acceptance_pending_for_user(
        &state.pool,
        &course_code,
        course_id,
        user.user_id,
        req.require_syllabus_acceptance,
    )
    .await?;

    Ok(Json(CourseSyllabusResponse {
        sections: req.sections,
        updated_at,
        require_syllabus_acceptance: req.require_syllabus_acceptance,
        syllabus_acceptance_pending,
    }))
}

fn map_open_router_err(e: OpenRouterError) -> AppError {
    match e {
        OpenRouterError::NoImageInResponse => AppError::AiGenerationFailed(
            "The model did not return an image. Try another model in Settings.".into(),
        ),
        OpenRouterError::ApiStatus(code, msg) => AppError::AiGenerationFailed(format!(
            "OpenRouter ({code}): {}",
            msg.chars().take(800).collect::<String>()
        )),
        OpenRouterError::Http(err) => AppError::AiGenerationFailed(err.to_string()),
        OpenRouterError::Json(err) => AppError::AiGenerationFailed(err.to_string()),
    }
}

async fn list_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CoursesResponse>, AppError> {
    let user = auth_user(&state, &headers)?;

    let courses = course::list_for_enrolled_user(&state.pool, user.user_id).await?;
    Ok(Json(CoursesResponse { courses }))
}

async fn create_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateCourseRequest>,
) -> Result<Json<CoursePublic>, AppError> {
    let user = require_permission(&state, &headers, PERM_COURSE_CREATE).await?;

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Course title is required.".into()));
    }

    let row =
        course::create_course(&state.pool, title, req.description.trim(), user.user_id).await?;
    Ok(Json(row))
}

async fn structure_list_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseStructureResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let rows = course_structure::list_for_course(&state.pool, course_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit_structure =
        rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    let rows = if can_edit_structure {
        rows
    } else {
        course_structure::filter_structure_for_student_view(rows, Utc::now())
    };
    let items = course_structure::rows_to_responses_with_quiz_adaptive(&state.pool, course_id, rows).await?;
    Ok(Json(CourseStructureResponse { items }))
}

async fn structure_reorder_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ReorderCourseStructureRequest>,
) -> Result<Json<CourseStructureResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    course_structure::apply_module_and_child_order(
        &state.pool,
        course_id,
        &body.module_order,
        &body.child_order_by_module,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::InvalidInput(
            "Invalid reorder: module or child ids must match the current structure.".into(),
        ),
        _ => e.into(),
    })?;

    let rows = course_structure::list_for_course(&state.pool, course_id).await?;
    let items = course_structure::rows_to_responses_with_quiz_adaptive(&state.pool, course_id, rows).await?;
    Ok(Json(CourseStructureResponse { items }))
}

async fn create_course_module_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateCourseModuleRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Module name is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = course_structure::insert_module(&state.pool, course_id, title).await?;
    let item = course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn patch_course_module_handler(
    State(state): State<AppState>,
    Path((course_code, module_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchCourseModuleRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Module name is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = course_structure::update_module(
        &state.pool,
        course_id,
        module_id,
        title,
        req.published,
        req.visible_from,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;
    let item = course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn create_module_heading_handler(
    State(state): State<AppState>,
    Path((course_code, module_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateCourseHeadingRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Heading title is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row =
        course_structure::insert_heading_under_module(&state.pool, course_id, module_id, title)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => AppError::NotFound,
                _ => e.into(),
            })?;
    let item = course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn create_module_assignment_handler(
    State(state): State<AppState>,
    Path((course_code, module_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateCourseAssignmentRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput(
            "Assignment name is required.".into(),
        ));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row =
        course_structure::insert_assignment_under_module(&state.pool, course_id, module_id, title)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => AppError::NotFound,
                _ => e.into(),
            })?;
    let item = course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn create_module_content_page_handler(
    State(state): State<AppState>,
    Path((course_code, module_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateCourseContentPageRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Page name is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = course_structure::insert_content_page_under_module(
        &state.pool,
        course_id,
        module_id,
        title,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;
    let item = course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn create_module_quiz_handler(
    State(state): State<AppState>,
    Path((course_code, module_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateCourseQuizRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Quiz name is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = course_structure::insert_quiz_under_module(&state.pool, course_id, module_id, title)
        .await
        .map_err(|e| match e {
            sqlx::Error::RowNotFound => AppError::NotFound,
            _ => e.into(),
        })?;
    let item = course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn module_content_page_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ModuleContentPageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::content_page_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    let Some((title, markdown, due_at, updated_at)) =
        course_module_content::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(ModuleContentPageResponse {
        item_id,
        title,
        markdown,
        due_at,
        updated_at,
    }))
}

async fn module_content_page_patch_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpdateModuleContentPageRequest>,
) -> Result<Json<ModuleContentPageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    if req.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
        return Err(AppError::InvalidInput("Content is too long.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let updated = course_module_content::update_markdown(
        &state.pool,
        course_id,
        item_id,
        req.markdown.trim_end(),
    )
    .await?;

    if updated.is_none() {
        return Err(AppError::NotFound);
    }

    if let Some(due_change) = req.due_at {
        course_structure::set_content_page_due_at(&state.pool, course_id, item_id, due_change)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => AppError::NotFound,
                _ => e.into(),
            })?;
    }

    let Some((title, markdown, due_at, updated_at)) =
        course_module_content::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(ModuleContentPageResponse {
        item_id,
        title,
        markdown,
        due_at,
        updated_at,
    }))
}

async fn module_assignment_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ModuleContentPageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::assignment_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    let Some((title, markdown, due_at, updated_at)) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(ModuleContentPageResponse {
        item_id,
        title,
        markdown,
        due_at,
        updated_at,
    }))
}

async fn module_assignment_patch_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpdateModuleContentPageRequest>,
) -> Result<Json<ModuleContentPageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    if req.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
        return Err(AppError::InvalidInput("Content is too long.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let updated = course_module_assignments::update_markdown(
        &state.pool,
        course_id,
        item_id,
        req.markdown.trim_end(),
    )
    .await?;

    if updated.is_none() {
        return Err(AppError::NotFound);
    }

    if let Some(due_change) = req.due_at {
        course_structure::set_assignment_due_at(&state.pool, course_id, item_id, due_change)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => AppError::NotFound,
                _ => e.into(),
            })?;
    }

    let Some((title, markdown, due_at, updated_at)) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(ModuleContentPageResponse {
        item_id,
        title,
        markdown,
        due_at,
        updated_at,
    }))
}

async fn module_quiz_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ModuleQuizResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::quiz_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    let Some(row) = course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(module_quiz_response_for_api(item_id, &row, can_edit)))
}

async fn module_quiz_patch_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpdateModuleQuizRequest>,
) -> Result<Json<ModuleQuizResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    if let Some(markdown) = &req.markdown {
        if markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
            return Err(AppError::InvalidInput("Content is too long.".into()));
        }
    }
    if let Some(questions) = &req.questions {
        validate_quiz_questions(questions)?;
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let patch_quiz_settings = quiz_settings_patch_requested(&req);
    let mut quiz_settings_write: Option<QuizSettingsWrite> = None;
    if patch_quiz_settings {
        let Some(cur) =
            course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
        else {
            return Err(AppError::NotFound);
        };
        let merged = merge_quiz_settings_write(&cur, &req);
        validate_quiz_comprehensive_settings(
            merged.unlimited_attempts,
            merged.max_attempts,
            &merged.grade_attempt_policy,
            merged.passing_score_percent,
            &merged.late_submission_policy,
            merged.late_penalty_percent,
            merged.time_limit_minutes,
            merged.per_question_time_limit_seconds,
            &merged.show_score_timing,
            &merged.review_visibility,
            &merged.review_when,
            &merged.adaptive_difficulty,
            &merged.adaptive_stop_rule,
            merged.random_question_pool_count,
            merged.quiz_access_code.as_deref(),
        )?;
        quiz_settings_write = Some(merged);
    }

    if let Some(title) = &req.title {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("Quiz title is required.".into()));
        }
        let updated = course_module_quizzes::update_title(&state.pool, course_id, item_id, title).await?;
        if updated.is_none() {
            return Err(AppError::NotFound);
        }
    }

    if let Some(markdown) = req.markdown {
        let updated =
            course_module_quizzes::update_markdown(&state.pool, course_id, item_id, markdown.trim_end())
                .await?;
        if updated.is_none() {
            return Err(AppError::NotFound);
        }
    }

    if let Some(questions) = req.questions {
        let updated =
            course_module_quizzes::update_questions(&state.pool, course_id, item_id, &questions)
                .await?;
        if updated.is_none() {
            return Err(AppError::NotFound);
        }
    }

    if let Some(due_change) = req.due_at {
        course_structure::set_quiz_due_at(&state.pool, course_id, item_id, due_change)
            .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => AppError::NotFound,
                _ => e.into(),
            })?;
    }

    if let Some(ref merged) = quiz_settings_write {
        let updated = course_module_quizzes::write_quiz_settings(
            &state.pool,
            course_id,
            item_id,
            merged,
        )
        .await?;
        if updated.is_none() {
            return Err(AppError::NotFound);
        }
    }

    let adaptive_keys = req.is_adaptive.is_some()
        || req.adaptive_system_prompt.is_some()
        || req.adaptive_source_item_ids.is_some()
        || req.adaptive_question_count.is_some();

    if adaptive_keys {
        let Some(cur) =
            course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
        else {
            return Err(AppError::NotFound);
        };
        let next_is = req.is_adaptive.unwrap_or(cur.is_adaptive);
        let next_prompt = req
            .adaptive_system_prompt
            .clone()
            .unwrap_or_else(|| cur.adaptive_system_prompt.clone());
        let next_ids = req
            .adaptive_source_item_ids
            .clone()
            .unwrap_or_else(|| cur.adaptive_source_item_ids.0.clone());
        let next_count = req
            .adaptive_question_count
            .unwrap_or(cur.adaptive_question_count);

        if next_is {
            validate_adaptive_quiz_settings(true, &next_prompt, &next_ids, next_count)?;
            let n = course_structure::count_structure_items_with_kinds(
                &state.pool,
                course_id,
                &next_ids,
                ADAPTIVE_SOURCE_KINDS,
            )
            .await?;
            if n != next_ids.len() as i64 {
                return Err(AppError::InvalidInput(
                    "One or more adaptive source items are invalid for this course.".into(),
                ));
            }
            let updated = course_module_quizzes::update_adaptive_config(
                &state.pool,
                course_id,
                item_id,
                true,
                next_prompt.trim(),
                &next_ids,
                next_count,
            )
            .await?;
            if updated.is_none() {
                return Err(AppError::NotFound);
            }
        } else {
            let updated = course_module_quizzes::update_adaptive_config(
                &state.pool,
                course_id,
                item_id,
                false,
                "",
                &[],
                5,
            )
            .await?;
            if updated.is_none() {
                return Err(AppError::NotFound);
            }
        }
    }

    let Some(row) = course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(module_quiz_response_for_api(item_id, &row, true)))
}

async fn module_quiz_adaptive_next_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<AdaptiveQuizNextRequest>,
) -> Result<Json<AdaptiveQuizNextResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::quiz_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    let Some(row) = course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    if !row.is_adaptive {
        return Err(AppError::InvalidInput(
            "This quiz is not configured for adaptive mode.".into(),
        ));
    }

    let total = row.adaptive_question_count;
    if req.history.len() >= total as usize {
        return Ok(Json(AdaptiveQuizNextResponse {
            finished: true,
            question: None,
            message: Some("You have completed all questions in this adaptive quiz.".into()),
        }));
    }

    for turn in &req.history {
        if turn.choice_weights.len() != turn.choices.len() {
            return Err(AppError::InvalidInput(
                "Each history entry must have choiceWeights aligned with choices.".into(),
            ));
        }
    }

    let bundle = course_module_quizzes::reference_markdown_for_items(
        &state.pool,
        course_id,
        &row.adaptive_source_item_ids.0,
    )
    .await?;

    let client = state
        .open_router
        .as_ref()
        .ok_or(AppError::AiNotConfigured)?;

    let model = user_ai_settings::get_course_setup_model_id(&state.pool, user.user_id).await?;

    let question = adaptive_quiz_ai::generate_adaptive_next_question(
        &state.pool,
        client.as_ref(),
        &model,
        &bundle,
        &row.adaptive_system_prompt,
        &row.adaptive_difficulty,
        row.adaptive_topic_balance,
        &row.adaptive_stop_rule,
        total,
        &req.history,
    )
    .await?;

    Ok(Json(AdaptiveQuizNextResponse {
        finished: false,
        question: Some(question),
        message: None,
    }))
}

async fn module_quiz_generate_questions_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<GenerateModuleQuizQuestionsRequest>,
) -> Result<Json<GenerateModuleQuizQuestionsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let prompt = req.prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::InvalidInput("Prompt is required.".into()));
    }
    if prompt.len() > MAX_QUIZ_GENERATION_PROMPT_LEN {
        return Err(AppError::InvalidInput("Prompt is too long.".into()));
    }
    if req.question_count < MIN_QUIZ_GENERATION_COUNT || req.question_count > MAX_QUIZ_GENERATION_COUNT {
        return Err(AppError::InvalidInput(format!(
            "questionCount must be between {MIN_QUIZ_GENERATION_COUNT} and {MAX_QUIZ_GENERATION_COUNT}."
        )));
    }

    let client = state
        .open_router
        .as_ref()
        .ok_or(AppError::AiNotConfigured)?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let exists = course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }

    let model = user_ai_settings::get_course_setup_model_id(&state.pool, user.user_id).await?;

    let questions = quiz_generation_ai::generate_quiz_questions(
        &state.pool,
        client.as_ref(),
        &model,
        prompt,
        req.question_count as usize,
    )
    .await?;

    validate_quiz_questions(&questions)?;

    Ok(Json(GenerateModuleQuizQuestionsResponse { questions }))
}

async fn grading_get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseGradingSettingsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let row = course_grading::get_settings_for_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn grading_put_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PutCourseGradingSettingsRequest>,
) -> Result<Json<CourseGradingSettingsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let scale = req.grading_scale.trim();
    if !GRADING_SCALES.contains(&scale) {
        return Err(AppError::InvalidInput("Invalid grading scale.".into()));
    }

    for g in &req.assignment_groups {
        if g.name.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Each assignment group needs a name.".into(),
            ));
        }
        if !g.weight_percent.is_finite() || g.weight_percent < 0.0 || g.weight_percent > 100.0 {
            return Err(AppError::InvalidInput(
                "Weights must be between 0 and 100.".into(),
            ));
        }
    }

    match course_grading::put_settings(&state.pool, &course_code, scale, &req.assignment_groups)
        .await
    {
        Ok(Some(row)) => Ok(Json(row)),
        Ok(None) => Err(AppError::NotFound),
        Err(PutError::UnknownGroupId(id)) => Err(AppError::InvalidInput(format!(
            "Unknown assignment group id: {id}"
        ))),
        Err(PutError::Db(e)) => Err(e.into()),
    }
}

async fn patch_structure_item_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchStructureItemRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    if req.title.is_none() && req.published.is_none() {
        return Err(AppError::InvalidInput(
            "Provide title and/or published.".into(),
        ));
    }

    let title_opt: Option<&str> = match &req.title {
        None => None,
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Err(AppError::InvalidInput("Title cannot be empty.".into()));
            }
            Some(t)
        }
    };

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = course_structure::patch_child_structure_item(
        &state.pool,
        course_id,
        item_id,
        title_opt,
        req.published,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;
    let item = course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn archive_structure_item_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    course_structure::archive_child_structure_item(&state.pool, course_id, item_id)
        .await
        .map_err(|e| match e {
            sqlx::Error::RowNotFound => AppError::NotFound,
            _ => e.into(),
        })?;
    Ok(StatusCode::NO_CONTENT)
}

async fn structure_item_assignment_group_patch_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchItemAssignmentGroupRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let Some(row) = course_structure::get_item_row(&state.pool, course_id, item_id).await? else {
        return Err(AppError::NotFound);
    };
    if row.kind != "content_page" && row.kind != "assignment" {
        return Err(AppError::InvalidInput(
            "Only content pages and assignments can belong to an assignment group.".into(),
        ));
    }

    if let Some(gid) = req.assignment_group_id {
        if !course_grading::group_belongs_to_course(&state.pool, course_id, gid).await? {
            return Err(AppError::InvalidInput(
                "That assignment group does not belong to this course.".into(),
            ));
        }
    }

    course_structure::set_item_assignment_group(
        &state.pool,
        course_id,
        item_id,
        req.assignment_group_id,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;

    let Some(updated) = course_structure::get_item_row(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    let item = course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, updated).await?;
    Ok(Json(item))
}

async fn get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseWithViewerResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let row = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    let viewer_enrollment_roles =
        enrollment::user_roles_in_course(&state.pool, &course_code, user.user_id).await?;
    Ok(Json(CourseWithViewerResponse {
        course: row,
        viewer_enrollment_roles,
    }))
}

async fn course_export_get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseExportV1>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    let ex = course_export_import::build_export(&state.pool, &course_code).await?;
    Ok(Json(ex))
}

async fn course_import_post_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CourseImportRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    course_export_import::apply_import(&state.pool, &course_code, req.mode, &req.export).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn enrollments_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseEnrollmentsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let enrollments = enrollment::list_for_course_code(&state.pool, &course_code).await?;
    let viewer_enrollment_roles =
        enrollment::user_roles_in_course(&state.pool, &course_code, user.user_id).await?;
    Ok(Json(CourseEnrollmentsResponse {
        enrollments,
        viewer_enrollment_roles,
    }))
}

async fn delete_enrollment_handler(
    State(state): State<AppState>,
    Path((course_code, enrollment_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_enrollments_update_permission(&course_code);
    if !rbac::user_has_permission(&state.pool, user.user_id, &required).await? {
        return Err(AppError::Forbidden);
    }

    match enrollment::delete_enrollment_for_course(&state.pool, &course_code, enrollment_id).await? {
        enrollment::EnrollmentDeleteOutcome::Deleted => Ok(StatusCode::NO_CONTENT),
        enrollment::EnrollmentDeleteOutcome::NotFound => Err(AppError::NotFound),
        enrollment::EnrollmentDeleteOutcome::CannotRemoveHighestRole => Err(AppError::InvalidInput(
            "You can't remove this enrollment while it's the person's primary role in the course."
                .into(),
        )),
    }
}

async fn enroll_self_as_student_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<EnrollSelfAsStudentResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_has_enrollment_role(&state.pool, &course_code, user.user_id, "teacher")
        .await?
    {
        return Err(AppError::Forbidden);
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let created =
        enrollment::insert_student_if_missing(&state.pool, course_id, user.user_id).await?;
    Ok(Json(EnrollSelfAsStudentResponse { created }))
}

async fn list_course_scoped_roles_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseScopedRolesResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_creator(&state, &course_code, user.user_id).await?;

    let roles = rbac::list_roles_by_scope(&state.pool, "course").await?;
    Ok(Json(CourseScopedRolesResponse { roles }))
}

async fn add_enrollments_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<AddEnrollmentsRequest>,
) -> Result<Json<AddEnrollmentsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let parsed = parse_email_list(&req.emails);
    if parsed.is_empty() {
        return Err(AppError::InvalidInput(
            "Enter at least one valid email address.".into(),
        ));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let is_creator =
        enrollment::user_is_course_creator(&state.pool, &course_code, user.user_id).await?;

    if req.app_role_id.is_some() && !is_creator {
        return Err(AppError::Forbidden);
    }
    if is_creator && req.app_role_id.is_none() {
        return Err(AppError::InvalidInput(
            "Select a course-scoped role for these enrollments.".into(),
        ));
    }

    let mut added = Vec::new();
    let mut already_enrolled = Vec::new();
    let mut not_found = Vec::new();

    if let Some(role_id) = req.app_role_id {
        let Some(role_row) = rbac::get_role(&state.pool, role_id).await? else {
            return Err(AppError::InvalidInput("Unknown role.".into()));
        };
        if role_row.scope != "course" {
            return Err(AppError::InvalidInput(
                "Only course-scoped roles can be used when enrolling with a role.".into(),
            ));
        }

        for email in parsed {
            let Some(row) = user::find_by_email(&state.pool, &email).await? else {
                not_found.push(email);
                continue;
            };
            if enrollment::user_is_course_creator(&state.pool, &course_code, row.id).await? {
                already_enrolled.push(row.email);
                continue;
            }
            let existed_before = !enrollment::user_roles_in_course(&state.pool, &course_code, row.id)
                .await?
                .is_empty();

            enrollment::upsert_instructor_enrollment(&state.pool, &course_code, course_id, row.id)
                .await?;
            course_grants::apply_app_role_course_grants(
                &state.pool,
                row.id,
                course_id,
                &course_code,
                role_id,
            )
            .await?;

            if existed_before {
                already_enrolled.push(row.email);
            } else {
                added.push(row.email);
            }
        }
    } else {
        for email in parsed {
            let Some(row) = user::find_by_email(&state.pool, &email).await? else {
                not_found.push(email);
                continue;
            };
            let inserted =
                enrollment::insert_student_if_missing(&state.pool, course_id, row.id).await?;
            if inserted {
                added.push(row.email);
            } else {
                already_enrolled.push(row.email);
            }
        }
    }

    Ok(Json(AddEnrollmentsResponse {
        added,
        already_enrolled,
        not_found,
    }))
}

async fn update_markdown_theme_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<UpdateMarkdownThemeRequest>,
) -> Result<Json<CoursePublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let preset = req.preset.trim();
    if preset.is_empty() || !MARKDOWN_THEME_PRESETS.contains(&preset) {
        return Err(AppError::InvalidInput(
            "Unknown markdown theme preset.".into(),
        ));
    }

    let custom_store: Option<MarkdownThemeCustom> = if preset == "custom" {
        Some(req.custom.unwrap_or_default())
    } else {
        None
    };

    let row =
        course::update_markdown_theme(&state.pool, &course_code, preset, custom_store.as_ref())
            .await?
            .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn update_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<UpdateCourseRequest>,
) -> Result<Json<CoursePublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Course title is required.".into()));
    }

    let row = course::update_course(
        &state.pool,
        &course::UpdateCourse {
            course_code: &course_code,
            title,
            description: req.description.trim(),
            published: req.published,
            starts_at: req.starts_at,
            ends_at: req.ends_at,
            visible_from: req.visible_from,
            hidden_at: req.hidden_at,
        },
    )
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn generate_image_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<GenerateCourseImageRequest>,
) -> Result<Json<GenerateCourseImageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let prompt = req.prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::InvalidInput(
            "Describe the image you want.".into(),
        ));
    }

    let client = state
        .open_router
        .as_ref()
        .ok_or(AppError::AiNotConfigured)?;

    let _exists = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;

    let model = user_ai_settings::get_image_model_id(&state.pool, user.user_id).await?;

    let image_url = client
        .generate_image(&model, prompt)
        .await
        .map_err(map_open_router_err)?;

    Ok(Json(GenerateCourseImageResponse { image_url }))
}

async fn set_hero_image_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<SetHeroImageRequest>,
) -> Result<Json<CoursePublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if req.image_url.is_none() && req.object_position.is_none() {
        return Err(AppError::InvalidInput(
            "Provide imageUrl and/or objectPosition.".into(),
        ));
    }

    let current = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;

    let new_url = match &req.image_url {
        None => current.hero_image_url.clone().ok_or_else(|| {
            AppError::InvalidInput("Set a hero image before adjusting position.".into())
        })?,
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Err(AppError::InvalidInput("Image URL cannot be empty.".into()));
            }
            t.to_string()
        }
    };

    let new_pos = match req.object_position {
        None => current.hero_image_object_position.clone(),
        Some(None) => None,
        Some(Some(s)) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
    };

    let row =
        course::set_hero_image_fields(&state.pool, &course_code, &new_url, new_pos.as_deref())
            .await?
            .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

#[cfg(test)]
mod parse_email_list_tests {
    use super::parse_email_list;

    #[test]
    fn splits_and_dedupes() {
        let v = parse_email_list("a@b.com, A@b.com ; c@d.org");
        assert_eq!(v, vec!["a@b.com".to_string(), "c@d.org".to_string()]);
    }

    #[test]
    fn skips_invalid_tokens() {
        assert!(parse_email_list("not-an-email").is_empty());
    }
}
