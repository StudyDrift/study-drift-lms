use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user, require_permission};
use crate::models::content_page_markups::{
    ContentPageMarkupResponse, ContentPageMarkupsListResponse, CreateContentPageMarkupRequest,
};
use crate::models::course::{
    CoursePublic, CourseWithViewerResponse, CoursesResponse, CreateCourseRequest,
    MarkdownThemeCustom, PatchCourseArchivedRequest, PutCourseCatalogOrderRequest,
    SetHeroImageRequest, UpdateCourseRequest, UpdateMarkdownThemeRequest, GRADING_SCALES,
    MARKDOWN_THEME_PRESETS,
};
use crate::models::course_export::{
    CourseCanvasImportRequest, CourseExportV1, CourseImportRequest,
};
use crate::models::course_gradebook::{
    CourseGradebookGridColumn, CourseGradebookGridResponse, CourseGradebookGridStudent,
    PutCourseGradebookGradesRequest,
};
use crate::models::course_grading::{
    CourseGradingSettingsResponse, PatchItemAssignmentGroupRequest, PutCourseGradingSettingsRequest,
};
use crate::models::course_module_assignment::validate_assignment_delivery_settings;
use crate::models::course_module_content::{
    CreateCourseContentPageRequest, ModuleContentPageResponse, UpdateModuleContentPageRequest,
};
use crate::models::course_module_quiz::{
    validate_adaptive_quiz_settings, validate_item_points_worth,
    validate_quiz_comprehensive_settings, validate_quiz_questions, AdaptiveQuizNextRequest,
    AdaptiveQuizNextResponse, CreateCourseQuizRequest, GenerateModuleQuizQuestionsRequest,
    GenerateModuleQuizQuestionsResponse, ModuleQuizResponse, QuizAttemptResponse,
    SubmitQuizAttemptRequest, UpdateModuleQuizRequest, ADAPTIVE_SOURCE_KINDS,
};
use crate::models::course_structure::{
    CourseStructureItemResponse, CourseStructureResponse, CreateCourseAssignmentRequest,
    CreateCourseExternalLinkRequest, CreateCourseHeadingRequest, CreateCourseModuleRequest,
    ModuleExternalLinkResponse, PatchCourseModuleRequest, PatchModuleExternalLinkRequest,
    PatchStructureItemDueAtRequest, PatchStructureItemRequest, ReorderCourseStructureRequest,
};
use crate::models::course_syllabus::{
    CourseSyllabusResponse, GenerateSyllabusSectionRequest, GenerateSyllabusSectionResponse,
    SyllabusAcceptanceStatusResponse, SyllabusSection, UpdateCourseSyllabusRequest,
};
use crate::models::enrollment::{
    AddEnrollmentsRequest, AddEnrollmentsResponse, CourseEnrollmentsResponse,
    EnrollSelfAsStudentResponse, PatchEnrollmentRequest,
};
use crate::models::enrollment_group::{
    CreateEnrollmentGroupRequest, CreateEnrollmentGroupSetRequest, EnrollmentGroupsTreeResponse,
    PatchEnrollmentGroupRequest, PatchEnrollmentGroupSetRequest,
    PutEnrollmentGroupMembershipRequest,
};
use crate::models::rbac::CourseScopedRolesResponse;
use crate::models::settings_ai::{GenerateCourseImageRequest, GenerateCourseImageResponse};
use crate::models::user_audit::PostCourseContextRequest;
use crate::repos::content_page_markups;
use crate::repos::course;
use crate::repos::course_files;
use crate::repos::course_grades;
use crate::repos::course_grading;
use crate::repos::course_grading::PutError;
use crate::repos::course_grants;
use crate::repos::course_module_assignments;
use crate::repos::course_module_content;
use crate::repos::course_module_external_links;
use crate::repos::course_module_quizzes::{self, QuizSettingsWrite};
use crate::repos::course_structure;
use crate::repos::course_syllabus;
use crate::repos::enrollment;
use crate::repos::enrollment_groups;
use crate::repos::rbac;
use crate::repos::syllabus_acceptance;
use crate::repos::syllabus_markups;
use crate::repos::user;
use crate::repos::user_ai_settings;
use crate::repos::user_audit;
use crate::services::adaptive_quiz_ai;
use crate::services::ai::OpenRouterError;
use crate::services::auth;
use crate::services::canvas_course_import;
use crate::services::course_export_import;
use crate::services::quiz_generation_ai;
use crate::services::relative_schedule;
use crate::services::syllabus_section_ai;
use crate::state::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use uuid::Uuid;

const PERM_COURSE_CREATE: &str = "global:app:course:create";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/courses", get(list_handler).post(create_handler))
        .route(
            "/api/v1/courses/catalog-order",
            put(put_course_catalog_order_handler),
        )
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
            "/api/v1/courses/{course_code}/structure/modules/{module_id}/external-links",
            post(create_module_external_link_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/external-links/{item_id}",
            get(module_external_link_get_handler).patch(module_external_link_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/content-pages/{item_id}",
            get(module_content_page_get_handler).patch(module_content_page_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/content-pages/{item_id}/markups",
            get(list_content_page_markups_handler).post(create_content_page_markup_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/content-pages/{item_id}/markups/{markup_id}",
            delete(delete_content_page_markup_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/markups",
            get(list_assignment_markups_handler).post(create_assignment_markup_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/markups/{markup_id}",
            delete(delete_assignment_markup_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}",
            get(module_assignment_get_handler).patch(module_assignment_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/markups",
            get(list_quiz_markups_handler).post(create_quiz_markup_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/markups/{markup_id}",
            delete(delete_quiz_markup_handler),
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
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts",
            post(quiz_attempt_start_handler).get(quiz_attempts_list_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts/{attempt_id}",
            post(quiz_attempt_submit_handler).get(quiz_attempt_get_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/archived",
            get(structure_archived_list_handler),
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
            delete(delete_enrollment_handler).patch(patch_enrollment_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollment-groups/enable",
            post(enrollment_groups_enable_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollment-groups",
            get(enrollment_groups_tree_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollment-groups/sets",
            post(enrollment_group_sets_create_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollment-groups/sets/{set_id}",
            patch(enrollment_group_sets_patch_handler).delete(enrollment_group_sets_delete_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollment-groups/sets/{set_id}/groups",
            post(enrollment_groups_create_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollment-groups/groups/{group_id}",
            patch(enrollment_groups_patch_handler).delete(enrollment_groups_delete_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollment-groups/memberships",
            put(enrollment_groups_membership_put_handler),
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
            "/api/v1/courses/{course_code}/syllabus/markups",
            get(list_syllabus_markups_handler).post(create_syllabus_markup_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/syllabus/markups/{markup_id}",
            delete(delete_syllabus_markup_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/markdown-theme",
            patch(update_markdown_theme_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/archived",
            patch(patch_course_archived_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/factory-reset",
            post(post_factory_reset_course_handler),
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
            "/api/v1/courses/{course_code}/import/canvas/ws",
            get(course_import_canvas_ws_handler),
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
            "/api/v1/courses/{course_code}/gradebook/grid",
            get(gradebook_grid_get_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/gradebook/grades",
            put(gradebook_grades_put_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/items/{item_id}/assignment-group",
            patch(structure_item_assignment_group_patch_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/items/{item_id}/due-at",
            patch(structure_item_due_at_patch_handler),
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

fn module_assignment_response_for_api(
    item_id: uuid::Uuid,
    row: &course_module_assignments::CourseItemAssignmentRow,
    can_edit: bool,
    shift: Option<&relative_schedule::RelativeShiftContext>,
) -> ModuleContentPageResponse {
    let due_at = match shift {
        Some(ctx) => relative_schedule::shift_opt(ctx, row.due_at),
        None => row.due_at,
    };
    let available_from = match shift {
        Some(ctx) => relative_schedule::shift_opt(ctx, row.available_from),
        None => row.available_from,
    };
    let available_until = match shift {
        Some(ctx) => relative_schedule::shift_opt(ctx, row.available_until),
        None => row.available_until,
    };
    let requires_assignment_access_code = row
        .assignment_access_code
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let assignment_access_code = can_edit
        .then(|| row.assignment_access_code.clone())
        .flatten()
        .filter(|s| !s.trim().is_empty());
    ModuleContentPageResponse {
        item_id,
        title: row.title.clone(),
        markdown: row.markdown.clone(),
        due_at,
        points_worth: row.points_worth,
        assignment_group_id: row.assignment_group_id,
        updated_at: row.updated_at,
        available_from,
        available_until,
        requires_assignment_access_code: Some(requires_assignment_access_code),
        assignment_access_code,
        submission_allow_text: Some(row.submission_allow_text),
        submission_allow_file_upload: Some(row.submission_allow_file_upload),
        submission_allow_url: Some(row.submission_allow_url),
    }
}

fn merge_assignment_body_write(
    cur: &course_module_assignments::CourseItemAssignmentRow,
    req: &UpdateModuleContentPageRequest,
) -> Result<course_module_assignments::AssignmentBodyWrite, AppError> {
    let markdown = req.markdown.trim_end().to_string();
    let points_worth = match &req.points_worth {
        None => cur.points_worth,
        Some(pw) => *pw,
    };
    let available_from = match &req.available_from {
        None => cur.available_from,
        Some(v) => *v,
    };
    let available_until = match &req.available_until {
        None => cur.available_until,
        Some(v) => *v,
    };
    let assignment_access_code = match &req.assignment_access_code {
        None => cur.assignment_access_code.clone(),
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
    let submission_allow_text = req
        .submission_allow_text
        .unwrap_or(cur.submission_allow_text);
    let submission_allow_file_upload = req
        .submission_allow_file_upload
        .unwrap_or(cur.submission_allow_file_upload);
    let submission_allow_url = req.submission_allow_url.unwrap_or(cur.submission_allow_url);
    Ok(course_module_assignments::AssignmentBodyWrite {
        markdown,
        points_worth,
        available_from,
        available_until,
        assignment_access_code,
        submission_allow_text,
        submission_allow_file_upload,
        submission_allow_url,
    })
}

fn module_quiz_response_for_api(
    item_id: Uuid,
    row: &course_module_quizzes::CourseItemQuizRow,
    show_adaptive_details: bool,
    shift: Option<&relative_schedule::RelativeShiftContext>,
) -> ModuleQuizResponse {
    let due_at = match shift {
        Some(ctx) => relative_schedule::shift_opt(ctx, row.due_at),
        None => row.due_at,
    };
    let available_from = match shift {
        Some(ctx) => relative_schedule::shift_opt(ctx, row.available_from),
        None => row.available_from,
    };
    let available_until = match shift {
        Some(ctx) => relative_schedule::shift_opt(ctx, row.available_until),
        None => row.available_until,
    };
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
        due_at,
        available_from,
        available_until,
        unlimited_attempts: row.unlimited_attempts,
        max_attempts: row.max_attempts,
        grade_attempt_policy: row.grade_attempt_policy.clone(),
        passing_score_percent: row.passing_score_percent,
        points_worth: row.points_worth,
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
        assignment_group_id: row.assignment_group_id,
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
        || req.points_worth.is_some()
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
    if let Some(v) = &req.points_worth {
        s.points_worth = *v;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    let meta = enrollment::enrollment_course_meta(&state.pool, user.user_id).await?;
    let courses: Vec<CoursePublic> = courses
        .into_iter()
        .map(|c| {
            if c.schedule_mode == "relative" {
                if let Some((role, started)) = meta.get(&c.id) {
                    if role == "student" {
                        return relative_schedule::materialize_course_for_student(c, *started);
                    }
                }
            }
            c
        })
        .collect();
    Ok(Json(CoursesResponse { courses }))
}

async fn put_course_catalog_order_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PutCourseCatalogOrderRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let expected = course::catalog_course_ids_for_user(&state.pool, user.user_id).await?;

    let got: HashSet<Uuid> = req.course_ids.iter().copied().collect();
    if got.len() != req.course_ids.len() {
        return Err(AppError::InvalidInput(
            "courseIds must not contain duplicates.".into(),
        ));
    }
    if req.course_ids.len() != expected.len() || got != expected {
        return Err(AppError::InvalidInput(
            "courseIds must list each catalog course exactly once.".into(),
        ));
    }

    course::replace_user_course_catalog_order(&state.pool, user.user_id, &req.course_ids).await?;
    Ok(StatusCode::NO_CONTENT)
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

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let rows = course_structure::list_for_course(&state.pool, course_id).await?;
    let rows = course_structure::filter_archived_items_from_structure_list(rows);
    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit_structure =
        rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    let mut rows = rows;
    if !can_edit_structure {
        if let Some(ctx) =
            relative_schedule::load_shift_context_for_user(&state.pool, &course_row, user.user_id)
                .await?
        {
            rows = relative_schedule::shift_structure_item_rows(rows, &ctx);
        }
        rows = course_structure::filter_structure_for_student_view(rows, Utc::now());
    }
    let items =
        course_structure::rows_to_responses_with_quiz_adaptive(&state.pool, course_id, rows)
            .await?;
    Ok(Json(CourseStructureResponse { items }))
}

async fn structure_archived_list_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseStructureResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let rows = course_structure::list_archived_staff_structure(&state.pool, course_id).await?;
    let items =
        course_structure::rows_to_responses_with_quiz_adaptive(&state.pool, course_id, rows)
            .await?;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    let rows = course_structure::filter_archived_items_from_structure_list(rows);
    let items =
        course_structure::rows_to_responses_with_quiz_adaptive(&state.pool, course_id, rows)
            .await?;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Module name is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = course_structure::insert_module(&state.pool, course_id, title).await?;
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn create_module_external_link_handler(
    State(state): State<AppState>,
    Path((course_code, module_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateCourseExternalLinkRequest>,
) -> Result<Json<CourseStructureItemResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Link title is required.".into()));
    }
    let url = course_module_external_links::validate_external_http_url(&req.url)?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = course_structure::insert_external_link_under_module(
        &state.pool,
        course_id,
        module_id,
        title,
        &url,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
    Ok(Json(item))
}

async fn module_external_link_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ModuleExternalLinkResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::external_link_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            user.user_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    let Some((title, url, updated_at)) =
        course_module_external_links::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(ModuleExternalLinkResponse {
        item_id,
        title,
        url,
        updated_at,
    }))
}

async fn module_external_link_patch_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchModuleExternalLinkRequest>,
) -> Result<Json<ModuleExternalLinkResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let normalized_url = course_module_external_links::validate_external_http_url(&req.url)?;
    let updated =
        course_module_external_links::update_url(&state.pool, course_id, item_id, &normalized_url)
            .await?;
    if updated.is_none() {
        return Err(AppError::NotFound);
    }

    let Some((title, url, updated_at)) =
        course_module_external_links::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(ModuleExternalLinkResponse {
        item_id,
        title,
        url,
        updated_at,
    }))
}

/// Course id after enrollment + (for students) published content page visibility checks.
async fn ensure_user_can_view_content_page(
    state: &AppState,
    course_code: &str,
    item_id: Uuid,
    user_id: Uuid,
) -> Result<Uuid, AppError> {
    require_course_access(state, course_code, user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let required = course_grants::course_item_create_permission(course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::content_page_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            user_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }
    Ok(course_id)
}

async fn ensure_user_can_view_assignment_for_markups(
    state: &AppState,
    course_code: &str,
    item_id: Uuid,
    user_id: Uuid,
) -> Result<Uuid, AppError> {
    require_course_access(state, course_code, user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let required = course_grants::course_item_create_permission(course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::assignment_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            user_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    Ok(course_id)
}

async fn ensure_user_can_view_quiz_for_markups(
    state: &AppState,
    course_code: &str,
    item_id: Uuid,
    user_id: Uuid,
) -> Result<Uuid, AppError> {
    require_course_access(state, course_code, user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let required = course_grants::course_item_create_permission(course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::quiz_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            user_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    Ok(course_id)
}

async fn module_content_page_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ModuleContentPageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_content_page(&state, &course_code, item_id, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    let shift_ctx = if !can_edit {
        relative_schedule::load_shift_context_for_user(&state.pool, &course_row, user.user_id)
            .await?
    } else {
        None
    };

    let Some((title, markdown, mut due_at, updated_at)) =
        course_module_content::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    if let Some(ctx) = shift_ctx {
        due_at = relative_schedule::shift_opt(&ctx, due_at);
    }

    Ok(Json(ModuleContentPageResponse {
        item_id,
        title,
        markdown,
        due_at,
        points_worth: None,
        assignment_group_id: None,
        updated_at,
        available_from: None,
        available_until: None,
        requires_assignment_access_code: None,
        assignment_access_code: None,
        submission_allow_text: None,
        submission_allow_file_upload: None,
        submission_allow_url: None,
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
        points_worth: None,
        assignment_group_id: None,
        updated_at,
        available_from: None,
        available_until: None,
        requires_assignment_access_code: None,
        assignment_access_code: None,
        submission_allow_text: None,
        submission_allow_file_upload: None,
        submission_allow_url: None,
    }))
}

async fn list_content_page_markups_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ContentPageMarkupsListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_content_page(&state, &course_code, item_id, user.user_id).await?;
    let markups =
        content_page_markups::list_for_user_item(&state.pool, user.user_id, course_id, item_id)
            .await?;
    Ok(Json(ContentPageMarkupsListResponse { markups }))
}

async fn create_content_page_markup_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateContentPageMarkupRequest>,
) -> Result<Json<ContentPageMarkupResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_content_page(&state, &course_code, item_id, user.user_id).await?;

    if let Err(msg) = content_page_markups::validate_markup_request(
        &req.kind,
        &req.quote_text,
        &req.notebook_page_id,
        &req.comment_text,
    ) {
        return Err(AppError::InvalidInput(msg));
    }

    let row = content_page_markups::insert(
        &state.pool,
        user.user_id,
        course_id,
        item_id,
        "content_page",
        &req.kind,
        &req.quote_text,
        req.notebook_page_id.as_deref(),
        req.comment_text.as_deref(),
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;

    Ok(Json(row))
}

async fn delete_content_page_markup_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, markup_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_content_page(&state, &course_code, item_id, user.user_id).await?;

    let deleted = content_page_markups::delete_owned(
        &state.pool,
        user.user_id,
        course_id,
        item_id,
        markup_id,
    )
    .await?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_assignment_markups_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ContentPageMarkupsListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_assignment_for_markups(&state, &course_code, item_id, user.user_id)
            .await?;
    let markups =
        content_page_markups::list_for_user_item(&state.pool, user.user_id, course_id, item_id)
            .await?;
    Ok(Json(ContentPageMarkupsListResponse { markups }))
}

async fn create_assignment_markup_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateContentPageMarkupRequest>,
) -> Result<Json<ContentPageMarkupResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_assignment_for_markups(&state, &course_code, item_id, user.user_id)
            .await?;

    if let Err(msg) = content_page_markups::validate_markup_request(
        &req.kind,
        &req.quote_text,
        &req.notebook_page_id,
        &req.comment_text,
    ) {
        return Err(AppError::InvalidInput(msg));
    }

    let row = content_page_markups::insert(
        &state.pool,
        user.user_id,
        course_id,
        item_id,
        "assignment",
        &req.kind,
        &req.quote_text,
        req.notebook_page_id.as_deref(),
        req.comment_text.as_deref(),
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;

    Ok(Json(row))
}

async fn delete_assignment_markup_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, markup_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_assignment_for_markups(&state, &course_code, item_id, user.user_id)
            .await?;

    let deleted = content_page_markups::delete_owned(
        &state.pool,
        user.user_id,
        course_id,
        item_id,
        markup_id,
    )
    .await?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_quiz_markups_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ContentPageMarkupsListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_quiz_for_markups(&state, &course_code, item_id, user.user_id).await?;
    let markups =
        content_page_markups::list_for_user_item(&state.pool, user.user_id, course_id, item_id)
            .await?;
    Ok(Json(ContentPageMarkupsListResponse { markups }))
}

async fn create_quiz_markup_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateContentPageMarkupRequest>,
) -> Result<Json<ContentPageMarkupResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_quiz_for_markups(&state, &course_code, item_id, user.user_id).await?;

    if let Err(msg) = content_page_markups::validate_markup_request(
        &req.kind,
        &req.quote_text,
        &req.notebook_page_id,
        &req.comment_text,
    ) {
        return Err(AppError::InvalidInput(msg));
    }

    let row = content_page_markups::insert(
        &state.pool,
        user.user_id,
        course_id,
        item_id,
        "quiz",
        &req.kind,
        &req.quote_text,
        req.notebook_page_id.as_deref(),
        req.comment_text.as_deref(),
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;

    Ok(Json(row))
}

async fn delete_quiz_markup_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, markup_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id =
        ensure_user_can_view_quiz_for_markups(&state, &course_code, item_id, user.user_id).await?;

    let deleted = content_page_markups::delete_owned(
        &state.pool,
        user.user_id,
        course_id,
        item_id,
        markup_id,
    )
    .await?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_syllabus_markups_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ContentPageMarkupsListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let markups =
        syllabus_markups::list_for_user_course(&state.pool, user.user_id, course_id).await?;
    Ok(Json(ContentPageMarkupsListResponse { markups }))
}

async fn create_syllabus_markup_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateContentPageMarkupRequest>,
) -> Result<Json<ContentPageMarkupResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if let Err(msg) = content_page_markups::validate_markup_request(
        &req.kind,
        &req.quote_text,
        &req.notebook_page_id,
        &req.comment_text,
    ) {
        return Err(AppError::InvalidInput(msg));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let row = syllabus_markups::insert(
        &state.pool,
        user.user_id,
        course_id,
        &req.kind,
        &req.quote_text,
        req.notebook_page_id.as_deref(),
        req.comment_text.as_deref(),
    )
    .await?;

    Ok(Json(row))
}

async fn delete_syllabus_markup_handler(
    State(state): State<AppState>,
    Path((course_code, markup_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let deleted =
        syllabus_markups::delete_owned(&state.pool, user.user_id, course_id, markup_id).await?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn module_assignment_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ModuleContentPageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    let shift_ctx = if !can_edit {
        relative_schedule::load_shift_context_for_user(&state.pool, &course_row, user.user_id)
            .await?
    } else {
        None
    };
    if !can_edit {
        let visible = course_structure::assignment_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            user.user_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    let Some(row) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(module_assignment_response_for_api(
        item_id,
        &row,
        can_edit,
        shift_ctx.as_ref(),
    )))
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
    assert_permission(&state.pool, user.user_id, &required).await?;

    if req.markdown.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
        return Err(AppError::InvalidInput("Content is too long.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let Some(cur) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    let merged_write = merge_assignment_body_write(&cur, &req)?;
    validate_item_points_worth(merged_write.points_worth)?;
    validate_assignment_delivery_settings(
        merged_write.available_from,
        merged_write.available_until,
        merged_write.assignment_access_code.as_deref(),
        merged_write.submission_allow_text,
        merged_write.submission_allow_file_upload,
        merged_write.submission_allow_url,
    )?;

    let updated = course_module_assignments::write_assignment_body(
        &state.pool,
        course_id,
        item_id,
        &merged_write,
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

    let Some(row) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(module_assignment_response_for_api(
        item_id, &row, true, None,
    )))
}

async fn module_quiz_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<ModuleQuizResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    let shift_ctx = if !can_edit {
        relative_schedule::load_shift_context_for_user(&state.pool, &course_row, user.user_id)
            .await?
    } else {
        None
    };
    if !can_edit {
        let visible = course_structure::quiz_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            user.user_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    let Some(row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(module_quiz_response_for_api(
        item_id,
        &row,
        can_edit,
        shift_ctx.as_ref(),
    )))
}

async fn module_quiz_patch_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<UpdateModuleQuizRequest>,
) -> Result<Json<ModuleQuizResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_items_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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
        validate_item_points_worth(merged.points_worth)?;
        quiz_settings_write = Some(merged);
    }

    if let Some(title) = &req.title {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("Quiz title is required.".into()));
        }
        let updated =
            course_module_quizzes::update_title(&state.pool, course_id, item_id, title).await?;
        if updated.is_none() {
            return Err(AppError::NotFound);
        }
    }

    if let Some(markdown) = req.markdown {
        let updated = course_module_quizzes::update_markdown(
            &state.pool,
            course_id,
            item_id,
            markdown.trim_end(),
        )
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
        let updated =
            course_module_quizzes::write_quiz_settings(&state.pool, course_id, item_id, merged)
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

    let Some(row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(module_quiz_response_for_api(
        item_id, &row, true, None,
    )))
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
            user.user_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    let Some(row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
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
            questions: vec![],
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

    let answered = req.history.len() as i32;
    let remaining = total - answered;
    let batch_size = remaining.clamp(1, 2);

    let questions = adaptive_quiz_ai::generate_adaptive_next_questions(
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
        batch_size,
    )
    .await?;

    Ok(Json(AdaptiveQuizNextResponse {
        finished: false,
        questions,
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

    let required = course_grants::course_items_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let prompt = req.prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::InvalidInput("Prompt is required.".into()));
    }
    if prompt.len() > MAX_QUIZ_GENERATION_PROMPT_LEN {
        return Err(AppError::InvalidInput("Prompt is too long.".into()));
    }
    if req.question_count < MIN_QUIZ_GENERATION_COUNT
        || req.question_count > MAX_QUIZ_GENERATION_COUNT
    {
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

    let exists =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?;
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

fn gradebook_max_points(item: &CourseStructureItemResponse) -> Option<i32> {
    if let Some(pw) = item.points_worth {
        return Some(pw);
    }
    if item.kind == "quiz" && item.is_adaptive != Some(true) {
        return item.points_possible;
    }
    None
}

async fn gradebook_students_and_columns(
    pool: &PgPool,
    course_code: &str,
) -> Result<
    (
        Uuid,
        Vec<CourseGradebookGridStudent>,
        Vec<CourseGradebookGridColumn>,
    ),
    AppError,
> {
    let Some(course_id) = course::get_id_by_course_code(pool, course_code).await? else {
        return Err(AppError::NotFound);
    };

    let student_rows = enrollment::list_student_users_for_course_code(pool, course_code).await?;
    let students: Vec<CourseGradebookGridStudent> = student_rows
        .into_iter()
        .map(|(user_id, display_name)| CourseGradebookGridStudent {
            user_id,
            display_name,
        })
        .collect();

    let rows = course_structure::list_for_course(pool, course_id).await?;
    let rows = course_structure::filter_archived_items_from_structure_list(rows);
    let items =
        course_structure::rows_to_responses_with_quiz_adaptive(pool, course_id, rows).await?;

    let columns: Vec<CourseGradebookGridColumn> = items
        .into_iter()
        .filter(|it| it.kind == "assignment" || it.kind == "quiz")
        .map(|it| {
            let max_points = gradebook_max_points(&it);
            CourseGradebookGridColumn {
                id: it.id,
                kind: it.kind,
                title: it.title,
                max_points,
                assignment_group_id: it.assignment_group_id,
            }
        })
        .collect();

    Ok((course_id, students, columns))
}

fn parse_gradebook_points_str(raw: &str) -> Result<Option<f64>, AppError> {
    let t = raw.trim();
    if t.is_empty() {
        return Ok(None);
    }
    let cleaned: String = t
        .chars()
        .filter(|c| *c != ',' && !c.is_whitespace())
        .collect();
    let n: f64 = cleaned
        .parse()
        .map_err(|_| AppError::InvalidInput("Each score must be a valid number.".into()))?;
    if !n.is_finite() || n < 0.0 {
        return Err(AppError::InvalidInput(
            "Each score must be a non-negative number.".into(),
        ));
    }
    Ok(Some(n))
}

fn ensure_points_within_max(points: f64, max_points: Option<i32>) -> Result<(), AppError> {
    if let Some(m) = max_points {
        if m > 0 && points > m as f64 + 1e-6 {
            return Err(AppError::InvalidInput(format!(
                "Score cannot exceed {} points for this item.",
                m
            )));
        }
    }
    Ok(())
}

async fn gradebook_grid_get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseGradebookGridResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_gradebook_view_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let (course_id, students, columns) =
        gradebook_students_and_columns(&state.pool, &course_code).await?;
    let grades = course_grades::list_for_course(&state.pool, course_id).await?;

    Ok(Json(CourseGradebookGridResponse {
        students,
        columns,
        grades,
    }))
}

async fn gradebook_grades_put_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PutCourseGradebookGradesRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let (course_id, students, columns) =
        gradebook_students_and_columns(&state.pool, &course_code).await?;

    let student_ok: HashSet<Uuid> = students.iter().map(|s| s.user_id).collect();
    let item_meta: HashMap<Uuid, Option<i32>> =
        columns.iter().map(|c| (c.id, c.max_points)).collect();

    let mut ops: Vec<(Uuid, Uuid, Option<f64>)> = Vec::new();

    for (user_id, row) in req.grades {
        if !student_ok.contains(&user_id) {
            return Err(AppError::InvalidInput(
                "Grades include a user who is not enrolled as a student in this course.".into(),
            ));
        }
        for (item_id, raw) in row {
            let Some(max_p) = item_meta.get(&item_id).copied() else {
                return Err(AppError::InvalidInput(
                    "Grades include a module item that is not part of this course gradebook."
                        .into(),
                ));
            };
            let parsed = parse_gradebook_points_str(&raw)?;
            match parsed {
                None => ops.push((user_id, item_id, None)),
                Some(p) => {
                    ensure_points_within_max(p, max_p)?;
                    ops.push((user_id, item_id, Some(p)));
                }
            }
        }
    }

    course_grades::upsert_and_delete(&state.pool, course_id, &ops).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn grading_get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseGradingSettingsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_gradebook_view_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    assert_permission(&state.pool, user.user_id, &required).await?;

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

async fn structure_item_due_at_patch_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchStructureItemDueAtRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_items_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let Some(row) = course_structure::get_item_row(&state.pool, course_id, item_id).await? else {
        return Err(AppError::NotFound);
    };

    if row.archived {
        return Err(AppError::InvalidInput(
            "Archived module items cannot be rescheduled from the calendar.".into(),
        ));
    }

    match row.kind.as_str() {
        "content_page" => {
            course_structure::set_content_page_due_at(
                &state.pool,
                course_id,
                item_id,
                Some(req.due_at),
            )
            .await
        }
        "assignment" => {
            course_structure::set_assignment_due_at(
                &state.pool,
                course_id,
                item_id,
                Some(req.due_at),
            )
            .await
        }
        "quiz" => {
            course_structure::set_quiz_due_at(&state.pool, course_id, item_id, Some(req.due_at))
                .await
        }
        _ => {
            return Err(AppError::InvalidInput(
                "Only content pages, assignments, and quizzes support a due date.".into(),
            ));
        }
    }
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;

    Ok(StatusCode::NO_CONTENT)
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
    assert_permission(&state.pool, user.user_id, &required).await?;

    if req.title.is_none() && req.published.is_none() && req.archived.is_none() {
        return Err(AppError::InvalidInput(
            "Provide title, published, and/or archived.".into(),
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
        req.archived,
    )
    .await
    .map_err(|e| match e {
        sqlx::Error::RowNotFound => AppError::NotFound,
        _ => e.into(),
    })?;
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, row).await?;
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let Some(row) = course_structure::get_item_row(&state.pool, course_id, item_id).await? else {
        return Err(AppError::NotFound);
    };
    if row.kind != "content_page" && row.kind != "assignment" && row.kind != "quiz" {
        return Err(AppError::InvalidInput(
            "Only content pages, assignments, and quizzes can belong to an assignment group."
                .into(),
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
    let item =
        course_structure::row_to_response_with_quiz_adaptive(&state.pool, course_id, updated)
            .await?;
    Ok(Json(item))
}

async fn get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseWithViewerResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let mut row = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    let viewer_enrollment_roles =
        enrollment::user_roles_in_course(&state.pool, &course_code, user.user_id).await?;
    let student_only = viewer_enrollment_roles.iter().any(|r| r == "student")
        && !viewer_enrollment_roles
            .iter()
            .any(|r| r == "teacher" || r == "instructor");
    if row.schedule_mode == "relative" && student_only {
        if let Some(started) =
            enrollment::student_enrollment_started_at(&state.pool, row.id, user.user_id).await?
        {
            row = relative_schedule::materialize_course_for_student(row, started);
        }
    }
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
    assert_permission(&state.pool, user.user_id, &required).await?;

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
    assert_permission(&state.pool, user.user_id, &required).await?;

    course_export_import::apply_import(&state.pool, &course_code, req.mode, &req.export).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasImportWsFirstMessage {
    auth_token: String,
    #[serde(flatten)]
    request: CourseCanvasImportRequest,
}

/// WebSocket: client sends one text frame (same JSON as the former POST body), then receives
/// `{"type":"progress","message":"…"}` lines followed by `{"type":"complete"}` or `{"type":"error","message":"…"}`.
async fn course_import_canvas_ws_handler(
    Path(course_code): Path<String>,
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    Ok(ws.on_upgrade(move |socket| handle_canvas_import_ws(socket, state, course_code)))
}

fn canvas_import_ws_error_message(err: &AppError) -> String {
    match err {
        AppError::InvalidInput(msg) => msg.clone(),
        AppError::Unauthorized => "Sign in required.".into(),
        AppError::Forbidden => "You do not have permission for this action.".into(),
        AppError::NotFound => "Course not found or you do not have access.".into(),
        AppError::Db(_) | AppError::Jwt(_) => {
            "Something went wrong while saving the import.".into()
        }
        _ => err.to_string(),
    }
}

async fn ws_send_json(socket: &mut WebSocket, value: serde_json::Value) -> bool {
    match serde_json::to_string(&value) {
        Ok(s) => socket.send(Message::Text(s.into())).await.is_ok(),
        Err(_) => false,
    }
}

async fn handle_canvas_import_ws(mut socket: WebSocket, state: AppState, course_code: String) {
    let first_text = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(t))) => break t,
            Some(Ok(Message::Ping(p))) => {
                let _ = socket.send(Message::Pong(p)).await;
            }
            Some(Ok(Message::Close(_))) | None => return,
            Some(Err(_)) => return,
            _ => {}
        }
    };

    let first: CanvasImportWsFirstMessage = match serde_json::from_str(&first_text) {
        Ok(r) => r,
        Err(_) => {
            let _ = ws_send_json(
                &mut socket,
                json!({
                    "type": "error",
                    "message": "Invalid JSON in the first message. Send authToken plus the former Canvas import POST body fields.",
                }),
            )
            .await;
            return;
        }
    };
    let user_id = match state.jwt.verify(&first.auth_token) {
        Ok(u) => u.user_id,
        Err(_) => {
            let _ = ws_send_json(
                &mut socket,
                json!({
                    "type": "error",
                    "message": "Sign in required.",
                }),
            )
            .await;
            return;
        }
    };
    let req = first.request;

    if let Err(e) = require_course_access(&state, &course_code, user_id).await {
        let _ = ws_send_json(
            &mut socket,
            json!({
                "type": "error",
                "message": canvas_import_ws_error_message(&e),
            }),
        )
        .await;
        return;
    }

    let required = course_grants::course_item_create_permission(&course_code);
    if let Err(e) = assert_permission(&state.pool, user_id, &required).await {
        let _ = ws_send_json(
            &mut socket,
            json!({
                "type": "error",
                "message": canvas_import_ws_error_message(&e),
            }),
        )
        .await;
        return;
    }

    let CourseCanvasImportRequest {
        mode,
        canvas_base_url,
        canvas_course_id,
        access_token,
    } = req;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let pool = state.pool.clone();
    let course_code_worker = course_code.clone();

    let worker = tokio::spawn(async move {
        let run = async {
            let client = Client::builder()
                .timeout(Duration::from_secs(180))
                .connect_timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("lextures/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| AppError::InvalidInput(format!("Could not start HTTP client: {e}")))?;

            let export = canvas_course_import::build_export_from_canvas_wire(
                &client,
                &canvas_base_url,
                &canvas_course_id,
                &access_token,
                &state.canvas_allowed_host_suffixes,
                Some(&tx),
            )
            .await?;

            let _ = tx.send(
                json!({
                    "type": "progress",
                    "message": "Saving imported content into your course…",
                })
                .to_string(),
            );

            course_export_import::apply_import(&pool, &course_code_worker, mode, &export).await?;
            Ok::<(), AppError>(())
        };

        match run.await {
            Ok(()) => {
                let _ = tx.send(json!({ "type": "complete" }).to_string());
            }
            Err(e) => {
                let _ = tx.send(
                    json!({
                        "type": "error",
                        "message": canvas_import_ws_error_message(&e),
                    })
                    .to_string(),
                );
            }
        }
    });

    while let Some(line) = rx.recv().await {
        if socket.send(Message::Text(line.into())).await.is_err() {
            break;
        }
    }
    let _ = worker.await;
}

async fn enrollments_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseEnrollmentsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_read_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let mut enrollments = enrollment::list_for_course_code(&state.pool, &course_code).await?;
    let enrollment_groups_enabled =
        enrollment_groups::enrollment_groups_enabled_for_course(&state.pool, &course_code).await?;
    if enrollment_groups_enabled {
        let map =
            enrollment_groups::list_memberships_for_course_code(&state.pool, &course_code).await?;
        for e in &mut enrollments {
            if let Some(m) = map.get(&e.id) {
                e.group_memberships = m.clone();
            }
        }
    }
    let viewer_enrollment_roles =
        enrollment::user_roles_in_course(&state.pool, &course_code, user.user_id).await?;
    Ok(Json(CourseEnrollmentsResponse {
        enrollments,
        viewer_enrollment_roles,
        enrollment_groups_enabled,
    }))
}

async fn enrollment_groups_require_enabled(
    pool: &PgPool,
    course_code: &str,
) -> Result<(), AppError> {
    if !enrollment_groups::enrollment_groups_enabled_for_course(pool, course_code).await? {
        return Err(AppError::InvalidInput(
            "Enrollment groups are not enabled for this course.".into(),
        ));
    }
    Ok(())
}

async fn enrollment_groups_enable_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    enrollment_groups::enable_enrollment_groups(&state.pool, course_id, &course_code).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn enrollment_groups_tree_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<EnrollmentGroupsTreeResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_read_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    if !enrollment_groups::enrollment_groups_enabled_for_course(&state.pool, &course_code).await? {
        return Err(AppError::InvalidInput(
            "Enrollment groups are not enabled for this course.".into(),
        ));
    }

    let tree = enrollment_groups::tree_for_course_code(&state.pool, &course_code).await?;
    Ok(Json(tree))
}

async fn enrollment_group_sets_create_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateEnrollmentGroupSetRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    enrollment_groups_require_enabled(&state.pool, &course_code).await?;

    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("Group set name is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let id = enrollment_groups::create_group_set(&state.pool, course_id, name).await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn enrollment_group_sets_patch_handler(
    State(state): State<AppState>,
    Path((course_code, set_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchEnrollmentGroupSetRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    enrollment_groups_require_enabled(&state.pool, &course_code).await?;

    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("Group set name is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let ok = enrollment_groups::patch_group_set_name(&state.pool, course_id, set_id, name).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn enrollment_group_sets_delete_handler(
    State(state): State<AppState>,
    Path((course_code, set_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    enrollment_groups_require_enabled(&state.pool, &course_code).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let ok = enrollment_groups::delete_group_set(&state.pool, course_id, set_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn enrollment_groups_create_handler(
    State(state): State<AppState>,
    Path((course_code, set_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateEnrollmentGroupRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    enrollment_groups_require_enabled(&state.pool, &course_code).await?;

    if !enrollment_groups::group_set_belongs_to_course(&state.pool, &course_code, set_id).await? {
        return Err(AppError::NotFound);
    }

    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("Group name is required.".into()));
    }

    let id = enrollment_groups::create_group_in_set(&state.pool, set_id, name).await?;
    Ok(Json(serde_json::json!({ "id": id })))
}

async fn enrollment_groups_patch_handler(
    State(state): State<AppState>,
    Path((course_code, group_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchEnrollmentGroupRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    enrollment_groups_require_enabled(&state.pool, &course_code).await?;

    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("Group name is required.".into()));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let ok = enrollment_groups::patch_group_name(&state.pool, course_id, group_id, name).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn enrollment_groups_delete_handler(
    State(state): State<AppState>,
    Path((course_code, group_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    enrollment_groups_require_enabled(&state.pool, &course_code).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let ok = enrollment_groups::delete_group(&state.pool, course_id, group_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn enrollment_groups_membership_put_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PutEnrollmentGroupMembershipRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    enrollment_groups_require_enabled(&state.pool, &course_code).await?;

    if !enrollment_groups::enrollment_is_assignable_student(
        &state.pool,
        &course_code,
        req.enrollment_id,
    )
    .await?
    {
        return Err(AppError::InvalidInput(
            "Only student enrollments can be assigned to groups.".into(),
        ));
    }

    let ok = enrollment_groups::set_membership(
        &state.pool,
        &course_code,
        req.enrollment_id,
        req.group_set_id,
        req.group_id,
    )
    .await?;

    if !ok {
        return Err(AppError::InvalidInput(
            "Enrollment or group is not part of this course.".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn patch_enrollment_handler(
    State(state): State<AppState>,
    Path((course_code, enrollment_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchEnrollmentRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let role_norm = req
        .role
        .as_ref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());

    match (req.app_role_id, role_norm.as_deref()) {
        (None, None) => Err(AppError::InvalidInput(
            "Send appRoleId or role (\"student\").".into(),
        )),
        (Some(_), Some(_)) => Err(AppError::InvalidInput(
            "Send only one of appRoleId or role.".into(),
        )),
        (None, Some(role_val)) => {
            if role_val != "student" {
                return Err(AppError::InvalidInput(
                    "Only role: \"student\" is supported.".into(),
                ));
            }
            let Some(row) =
                enrollment::get_enrollment_for_patch(&state.pool, &course_code, enrollment_id)
                    .await?
            else {
                return Err(AppError::NotFound);
            };
            if row.role == "teacher" {
                return Err(AppError::InvalidInput(
                    "The teacher enrollment cannot be changed here.".into(),
                ));
            }
            if row.role != "instructor" {
                return Err(AppError::InvalidInput(
                    "Only instructor enrollments can be demoted to student.".into(),
                ));
            }
            let ok = enrollment::demote_instructor_enrollment_row(
                &state.pool,
                &course_code,
                enrollment_id,
            )
            .await?;
            if !ok {
                return Err(AppError::NotFound);
            }
            Ok(StatusCode::NO_CONTENT)
        }
        (Some(app_role_id), None) => {
            require_course_creator(&state, &course_code, user.user_id).await?;

            let Some(row) =
                enrollment::get_enrollment_for_patch(&state.pool, &course_code, enrollment_id)
                    .await?
            else {
                return Err(AppError::NotFound);
            };
            if row.role == "teacher" {
                return Err(AppError::InvalidInput(
                    "The teacher enrollment cannot be changed here.".into(),
                ));
            }
            let Some(role_row) = rbac::get_role(&state.pool, app_role_id).await? else {
                return Err(AppError::InvalidInput("Unknown role.".into()));
            };
            if role_row.scope != "course" {
                return Err(AppError::InvalidInput(
                    "Only course-scoped roles can be used when setting a course role.".into(),
                ));
            }

            let target_roles =
                enrollment::user_roles_in_course(&state.pool, &course_code, row.user_id).await?;
            if target_roles.iter().any(|r| r == "teacher") {
                return Err(AppError::InvalidInput(
                    "This person's teacher enrollment can't be updated this way.".into(),
                ));
            }
            if row.role == "student" && target_roles.iter().any(|r| r == "instructor") {
                return Err(AppError::InvalidInput(
                    "This person already has instructor access in this course.".into(),
                ));
            }
            if enrollment::user_is_course_creator(&state.pool, &course_code, row.user_id).await? {
                return Err(AppError::InvalidInput(
                    "The course creator's enrollment can't be changed this way.".into(),
                ));
            }

            let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await?
            else {
                return Err(AppError::NotFound);
            };

            if row.role == "student" {
                enrollment::upsert_instructor_enrollment(
                    &state.pool,
                    &course_code,
                    course_id,
                    row.user_id,
                )
                .await?;
            }

            course_grants::replace_course_app_role_grants_for_user(
                &state.pool,
                row.user_id,
                course_id,
                &course_code,
                app_role_id,
            )
            .await?;
            Ok(StatusCode::NO_CONTENT)
        }
    }
}

async fn delete_enrollment_handler(
    State(state): State<AppState>,
    Path((course_code, enrollment_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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

    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let required = course_grants::course_enrollments_update_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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
            let existed_before =
                !enrollment::user_roles_in_course(&state.pool, &course_code, row.id)
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

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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

async fn patch_course_archived_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PatchCourseArchivedRequest>,
) -> Result<Json<CoursePublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let row = course::set_course_archived(&state.pool, &course_code, req.archived)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

async fn post_factory_reset_course_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CoursePublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let outcome = course::factory_reset_course(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;

    course_files::remove_stored_blobs(
        &state.course_files_root,
        &course_code,
        &outcome.removed_course_file_storage_keys,
    )
    .await;

    Ok(Json(outcome.course))
}

async fn update_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<UpdateCourseRequest>,
) -> Result<Json<CoursePublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("Course title is required.".into()));
    }

    let existing = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;

    let mode_str = req
        .schedule_mode
        .as_deref()
        .unwrap_or(existing.schedule_mode.as_str())
        .trim();
    if mode_str != "fixed" && mode_str != "relative" {
        return Err(AppError::InvalidInput("Invalid scheduleMode.".into()));
    }

    let rel_end = normalize_relative_duration_iso(req.relative_end_after.as_deref())?;
    let rel_hidden = normalize_relative_duration_iso(req.relative_hidden_after.as_deref())?;

    let (
        starts_at,
        ends_at,
        visible_from,
        hidden_at,
        schedule_mode,
        relative_end_after,
        relative_hidden_after,
        relative_schedule_anchor_at,
    ) = if mode_str == "relative" {
        let anchor_at = existing
            .relative_schedule_anchor_at
            .or(existing.starts_at)
            .unwrap_or_else(Utc::now);
        (
            None,
            None,
            None,
            None,
            "relative",
            rel_end.as_deref(),
            rel_hidden.as_deref(),
            Some(anchor_at),
        )
    } else {
        (
            req.starts_at,
            req.ends_at,
            req.visible_from,
            req.hidden_at,
            "fixed",
            None,
            None,
            None,
        )
    };

    let row = course::update_course(
        &state.pool,
        &course::UpdateCourse {
            course_code: &course_code,
            title,
            description: req.description.trim(),
            published: req.published,
            starts_at,
            ends_at,
            visible_from,
            hidden_at,
            schedule_mode,
            relative_end_after,
            relative_hidden_after,
            relative_schedule_anchor_at,
        },
    )
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

fn normalize_relative_duration_iso(input: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(s) = input else {
        return Ok(None);
    };
    let t = s.trim();
    if t.is_empty() {
        return Ok(None);
    }
    relative_schedule::parse_iso8601_duration(t).map_err(|m| AppError::InvalidInput(m.into()))?;
    Ok(Some(t.to_ascii_uppercase()))
}

async fn generate_image_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<GenerateCourseImageRequest>,
) -> Result<Json<GenerateCourseImageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

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

async fn quiz_attempt_start_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<QuizAttemptResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    // Verify student can access the quiz (check visibility and enrollment)
    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit {
        let visible = course_structure::quiz_visible_to_student(
            &state.pool,
            course_id,
            item_id,
            user.user_id,
            Utc::now(),
        )
        .await?;
        if !visible {
            return Err(AppError::NotFound);
        }
    }

    // Get quiz settings
    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    // Check attempt limit
    if !quiz_row.unlimited_attempts {
        let submitted_attempts =
            course_module_quizzes::get_student_attempts(&state.pool, user.user_id, item_id).await?;
        if submitted_attempts.len() >= quiz_row.max_attempts as usize {
            return Err(AppError::InvalidInput(
                "You have reached the maximum number of attempts for this quiz.".into(),
            ));
        }
    }

    // Get next attempt number and create the attempt
    let next_attempt_num =
        course_module_quizzes::get_next_attempt_number(&state.pool, user.user_id, item_id).await?;

    let attempt_id = course_module_quizzes::insert_attempt(
        &state.pool,
        course_id,
        user.user_id,
        item_id,
        next_attempt_num,
    )
    .await?;

    Ok(Json(QuizAttemptResponse {
        attempt_id,
        attempt_number: next_attempt_num,
        submitted_at: Utc::now(),
        score: None,
        max_score: None,
        percent: None,
    }))
}

async fn quiz_attempt_submit_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, attempt_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<SubmitQuizAttemptRequest>,
) -> Result<Json<QuizAttemptResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    // Get quiz row
    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    // Check access code if required
    if let Some(code) = &quiz_row.quiz_access_code {
        if !code.is_empty() {
            let provided = req.access_code.as_deref().unwrap_or("");
            if provided != code {
                return Err(AppError::InvalidInput("Invalid quiz access code.".into()));
            }
        }
    }

    // Check late submission policy
    let now = Utc::now();
    if let Some(due_at) = quiz_row.due_at {
        if now > due_at && quiz_row.late_submission_policy == "block" {
            return Err(AppError::InvalidInput(
                "Cannot submit after due date. Late submissions are not allowed.".into(),
            ));
        }
    }

    // Calculate score (simple: count correct answers for multiple choice)
    let mut score = 0.0;
    let max_score: f64 = quiz_row
        .questions_json
        .iter()
        .map(|q| q.points as f64)
        .sum();

    for (idx, answer) in req.answers.iter().enumerate() {
        if idx < quiz_row.questions_json.len() {
            let question = &quiz_row.questions_json[idx];
            // For MC/TF questions, check if answer is correct
            if matches!(
                question.question_type.as_str(),
                "multiple_choice" | "true_false"
            ) {
                if let Some(selected_idx) = answer.selected_choice_index {
                    if Some(selected_idx) == question.correct_choice_index {
                        score += question.points as f64;
                    }
                }
            }
            // For essay/short_answer, we'd need instructor grading (not auto-graded here)
        }
    }

    // Apply late penalty if applicable
    if let Some(due_at) = quiz_row.due_at {
        if now > due_at && quiz_row.late_submission_policy == "penalty" {
            if let Some(penalty_pct) = quiz_row.late_penalty_percent {
                let penalty = score * (penalty_pct as f64 / 100.0);
                score = (score - penalty).max(0.0);
            }
        }
    }

    // Submit attempt
    let submitted = course_module_quizzes::submit_attempt(
        &state.pool,
        attempt_id,
        user.user_id,
        item_id,
        &req.answers,
        req.time_spent_seconds,
        Some(score),
        Some(max_score),
    )
    .await?
    .ok_or(AppError::NotFound)?;

    // Update course_grades with the best score if applicable
    let all_attempts =
        course_module_quizzes::get_student_attempts(&state.pool, user.user_id, item_id).await?;

    let final_score = match quiz_row.grade_attempt_policy.as_str() {
        "highest" => all_attempts
            .iter()
            .filter_map(|a| a.score)
            .fold(f64::NEG_INFINITY, f64::max),
        "latest" => submitted.score.unwrap_or(0.0),
        "first" => all_attempts.first().and_then(|a| a.score).unwrap_or(0.0),
        "average" => {
            let sum: f64 = all_attempts.iter().filter_map(|a| a.score).sum();
            let count = all_attempts.iter().filter(|a| a.score.is_some()).count();
            if count > 0 {
                sum / count as f64
            } else {
                0.0
            }
        }
        _ => 0.0,
    };

    // Update or insert grade record if quiz has points_worth
    if let Some(points_worth) = quiz_row.points_worth {
        let percent = (final_score / max_score.max(1.0)) * 100.0;
        let earned_points = (percent / 100.0) * points_worth as f64;
        let _ = course_grades::upsert_and_delete(
            &state.pool,
            course_id,
            &[(user.user_id, item_id, Some(earned_points))],
        )
        .await;
    }

    let percent = if max_score > 0.0 {
        Some((score / max_score) * 100.0)
    } else {
        None
    };

    Ok(Json(QuizAttemptResponse {
        attempt_id: submitted.id,
        attempt_number: submitted.attempt_number,
        submitted_at: submitted.submitted_at.unwrap_or_else(Utc::now),
        score: submitted.score,
        max_score: submitted.max_score,
        percent,
    }))
}

async fn quiz_attempts_list_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<Vec<QuizAttemptResponse>>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    // Check if quiz exists
    let _quiz = course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id)
        .await?
        .ok_or(AppError::NotFound)?;

    // Get student's attempts
    let attempts =
        course_module_quizzes::get_student_attempts(&state.pool, user.user_id, item_id).await?;

    let responses = attempts
        .into_iter()
        .map(|a| QuizAttemptResponse {
            attempt_id: a.id,
            attempt_number: a.attempt_number,
            submitted_at: a.submitted_at.unwrap_or_else(Utc::now),
            score: a.score,
            max_score: a.max_score,
            percent: a
                .score
                .zip(a.max_score)
                .map(|(s, m)| if m > 0.0 { (s / m) * 100.0 } else { 0.0 }),
        })
        .collect();

    Ok(Json(responses))
}

async fn quiz_attempt_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, attempt_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<QuizAttemptResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    // Check if quiz exists
    let _quiz = course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id)
        .await?
        .ok_or(AppError::NotFound)?;

    // Get attempt
    let attempt = course_module_quizzes::get_attempt_by_id(&state.pool, attempt_id)
        .await?
        .ok_or(AppError::NotFound)?;

    // Verify ownership (student can only see their own attempts, instructors can see all)
    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit && attempt.student_user_id != user.user_id {
        return Err(AppError::NotFound);
    }

    let percent =
        attempt
            .score
            .zip(attempt.max_score)
            .map(|(s, m)| if m > 0.0 { (s / m) * 100.0 } else { 0.0 });

    Ok(Json(QuizAttemptResponse {
        attempt_id: attempt.id,
        attempt_number: attempt.attempt_number,
        submitted_at: attempt.submitted_at.unwrap_or_else(Utc::now),
        score: attempt.score,
        max_score: attempt.max_score,
        percent,
    }))
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
