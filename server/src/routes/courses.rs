use crate::error::AppError;
use crate::models::assignment_rubric::{self, RubricDefinition};
use crate::http_auth::{assert_permission, auth_user, require_permission};
use crate::models::content_page_markups::{
    ContentPageMarkupResponse, ContentPageMarkupsListResponse, CreateContentPageMarkupRequest,
};
use crate::models::adaptive_path::{
    AdaptivePathPreviewQuery, AdaptivePathPreviewResponse, CreateStructurePathRuleRequest,
    StructurePathRuleResponse,
};
use crate::models::course::{
    CoursePublic, CourseWithViewerResponse, CoursesResponse, CreateCourseRequest,
    MarkdownThemeCustom, PatchCourseArchivedRequest, PatchCourseFeaturesRequest,
    PutCourseCatalogOrderRequest, SetHeroImageRequest, UpdateCourseRequest, UpdateMarkdownThemeRequest,
    GRADING_SCALES, MARKDOWN_THEME_PRESETS,
};
use crate::models::course_export::{CourseCanvasImportRequest, CourseExportV1, CourseImportRequest};
use crate::models::course_gradebook::{
    CourseGradebookGridColumn, CourseGradebookGridResponse, CourseGradebookGridStudent,
    CourseMyGradesResponse, PutCourseGradebookGradesRequest,
};
use crate::models::course_grading::{
    CourseGradingSettingsResponse, PatchItemAssignmentGroupRequest, PutCourseGradingSettingsRequest,
};
use crate::models::course_module_assignment::{
    validate_assignment_delivery_settings, validate_assignment_late_settings,
};
use crate::models::course_module_content::{
    CreateCourseContentPageRequest, GenerateAssignmentRubricRequest, GenerateAssignmentRubricResponse,
    ModuleContentPageResponse, UpdateModuleContentPageRequest,
};
use crate::models::course_module_quiz::{
    sanitize_quiz_questions_for_learner, validate_adaptive_quiz_settings, validate_item_points_worth,
    validate_quiz_comprehensive_settings, validate_quiz_questions, AdaptiveQuizNextRequest,
    AdaptiveQuizNextResponse, CreateCourseQuizRequest, GenerateModuleQuizQuestionsRequest,
    GenerateModuleQuizQuestionsResponse, ModuleQuizGetQuery, ModuleQuizResponse, QuizQuestion,
    QuizQuestionResponseItem,     QuizAdvanceResponse, QuizAttemptHintRequest, QuizCurrentQuestionResponse, QuizFocusLossEventApi,
    EnrollmentQuizOverrideUpsertRequest, QuizAttemptSummary, QuizAttemptsListResponse,
    QuizFocusLossEventsResponse, QuizFocusLossRequest, QuizResultsQuestionResult,
    QuizResultsResponse, QuizResultsScoreSummary, QuizStartRequest, QuizStartResponse, QuizSubmitRequest,
    QuizSubmitResponse, UpdateModuleQuizRequest, ADAPTIVE_SOURCE_KINDS,
};
use crate::models::course_structure::{
    CourseStructureItemResponse, CourseStructureResponse, CreateCourseAssignmentRequest,
    CreateCourseExternalLinkRequest, CreateCourseHeadingRequest, CreateCourseModuleRequest,
    ModuleExternalLinkResponse, PatchCourseModuleRequest, PatchModuleExternalLinkRequest,
    PatchStructureItemDueAtRequest, PatchStructureItemRequest, ReorderCourseStructureRequest,
};
use crate::models::course_outcomes_api::{
    CourseOutcomeApi, CourseOutcomeLinkApi, CourseOutcomesListResponse, PatchCourseOutcomeRequest,
    PostCourseOutcomeLinkRequest, PostCourseOutcomeRequest,
};
use crate::models::course_syllabus::{
    CourseSyllabusResponse, GenerateSyllabusSectionRequest, GenerateSyllabusSectionResponse,
    SyllabusAcceptanceStatusResponse, SyllabusSection, UpdateCourseSyllabusRequest,
};
use crate::models::standards::CourseStandardsCoverageResponse;
use crate::models::enrollment::{
    AddEnrollmentsRequest, AddEnrollmentsResponse, CourseEnrollmentsResponse,
    EnrollSelfAsStudentResponse, PatchEnrollmentRequest,
};
use crate::models::enrollment_group::{
    CreateEnrollmentGroupRequest, CreateEnrollmentGroupSetRequest, EnrollmentGroupsTreeResponse,
    PatchEnrollmentGroupRequest, PatchEnrollmentGroupSetRequest, PutEnrollmentGroupMembershipRequest,
};
use crate::models::rbac::CourseScopedRolesResponse;
use crate::models::settings_ai::{GenerateCourseImageRequest, GenerateCourseImageResponse};
use crate::models::user_audit::PostCourseContextRequest;
use crate::repos::adaptive_path as adaptive_path_repo;
use crate::repos::content_page_markups;
use crate::repos::concepts::{self, ConceptJson};
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
use crate::repos::course_outcomes;
use crate::repos::course_structure;
use crate::repos::course_syllabus;
use crate::repos::enrollment;
use crate::repos::enrollment_groups;
use crate::repos::enrollment_quiz_overrides;
use crate::repos::question_bank as qb_repo;
use crate::repos::quiz_attempts;
use crate::repos::rbac;
use crate::repos::syllabus_acceptance;
use crate::repos::syllabus_markups;
use crate::repos::user_ai_settings;
use crate::repos::user_audit;
use crate::services::adaptive_path as adaptive_path_service;
use crate::services::adaptive_quiz_ai;
use crate::services::learner_state::{self, LearnerStateService, DEFAULT_LEARNER_STATE_SERVICE};
use crate::services::assignment_rubric_ai;
use crate::services::question_bank;
use crate::services::accommodations;
use crate::services::code_execution::{self, CodeExecutionResult, ExecuteCodeRequest};
use crate::services::quiz_attempt_grading;
use crate::services::quiz_lockdown;
use crate::services::enrollments as enrollments_service;
use crate::services::outcomes as outcomes_service;
use crate::services::quiz_submission;
use crate::services::ai::OpenRouterError;
use crate::services::canvas_course_import;
use crate::services::course_export_import;
use crate::services::quiz_generation_ai;
use crate::services::relative_schedule;
use crate::services::standards as standards_service;
use crate::services::syllabus_section_ai;
use crate::state::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use chrono::{DateTime, Utc};
use reqwest::Client;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use uuid::Uuid;

const PERM_COURSE_CREATE: &str = "global:app:course:create";
const CODE_RUNS_PER_MINUTE: usize = 10;
static CODE_RUN_RATE_LIMIT: OnceLock<Mutex<HashMap<Uuid, Vec<DateTime<Utc>>>>> = OnceLock::new();

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
            "/api/v1/courses/{course_code}/assignments/{item_id}/generate-rubric",
            post(module_assignment_generate_rubric_handler),
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
            "/api/v1/courses/{course_code}/quizzes/{item_id}/start",
            post(module_quiz_start_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/submit",
            post(module_quiz_submit_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/results",
            get(module_quiz_results_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts",
            get(module_quiz_attempts_list_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts/{attempt_id}/current-question",
            get(quiz_attempt_current_question_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts/{attempt_id}/questions/{question_id}/run",
            post(quiz_attempt_question_run_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts/{attempt_id}/advance",
            post(quiz_attempt_advance_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts/{attempt_id}/focus-loss",
            post(quiz_attempt_focus_loss_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts/{attempt_id}/focus-loss-events",
            get(quiz_attempt_focus_loss_events_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/quizzes/{item_id}/attempts/{attempt_id}/hint",
            post(quiz_attempt_hint_stub_handler),
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
            "/api/v1/courses/{course_code}/enrollments/{enrollment_id}/quiz-overrides",
            post(enrollment_quiz_override_upsert_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/enrollments/{enrollment_id}/quiz-overrides/{item_id}",
            delete(enrollment_quiz_override_delete_handler),
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
            "/api/v1/courses/{course_code}/features",
            patch(patch_course_features_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/standards-coverage",
            get(course_standards_coverage_handler),
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
            "/api/v1/courses/{course_code}/outcomes",
            get(course_outcomes_list_handler).post(course_outcomes_create_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/outcomes/{outcome_id}",
            patch(course_outcomes_patch_handler).delete(course_outcomes_delete_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/outcomes/{outcome_id}/links",
            post(course_outcomes_add_link_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/outcomes/{outcome_id}/links/{link_id}",
            delete(course_outcomes_delete_link_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/gradebook/grid",
            get(gradebook_grid_get_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/my-grades",
            get(my_grades_get_handler),
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
        .route(
            "/api/v1/courses/{course_code}/structure/items/{item_id}/path-rules",
            get(path_rules_list_handler).post(path_rules_post_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/structure/items/{item_id}/path-rules/{rule_id}",
            delete(path_rules_delete_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/adaptive-path",
            get(adaptive_path_preview_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/concepts-for-path",
            get(course_concepts_for_path_handler),
        )
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
                return Err(AppError::invalid_input(
                    "course_visit must not include structureItemId.",
                ));
            }
            user_audit::insert(&state.pool, user.user_id, course_id, None, "course_visit").await?;
        }
        "content_open" | "content_leave" => {
            let Some(sid) = req.structure_item_id else {
                return Err(AppError::invalid_input(
                    "content_open and content_leave require structureItemId.",
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
            return Err(AppError::invalid_input(
                "Invalid kind. Expected course_visit, content_open, or content_leave.",
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
const MAX_ASSIGNMENT_RUBRIC_PROMPT_LEN: usize = 8_000;
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
        late_submission_policy: Some(row.late_submission_policy.clone()),
        late_penalty_percent: row.late_penalty_percent,
        rubric: row
            .rubric_json
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
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
    let late_submission_policy = match &req.late_submission_policy {
        None => cur.late_submission_policy.clone(),
        Some(s) => s.trim().to_string(),
    };
    let late_penalty_percent = match &req.late_penalty_percent {
        None => cur.late_penalty_percent,
        Some(v) => *v,
    };
    let rubric_json = match &req.rubric {
        None => cur.rubric_json.clone(),
        Some(None) => None,
        Some(Some(r)) => Some(
            serde_json::to_value(r).map_err(|e| AppError::invalid_input(e.to_string()))?,
        ),
    };
    Ok(course_module_assignments::AssignmentBodyWrite {
        markdown,
        points_worth,
        available_from,
        available_until,
        assignment_access_code,
        submission_allow_text,
        submission_allow_file_upload,
        submission_allow_url,
        late_submission_policy,
        late_penalty_percent,
        rubric_json,
    })
}

fn module_quiz_response_for_api(
    item_id: Uuid,
    row: &course_module_quizzes::CourseItemQuizRow,
    show_adaptive_details: bool,
    shift: Option<&relative_schedule::RelativeShiftContext>,
    course_lockdown_enabled: bool,
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
    let effective_lockdown = quiz_lockdown::effective_lockdown_mode(course_lockdown_enabled, row);
    let lockdown_mode = if show_adaptive_details {
        row.lockdown_mode.clone()
    } else {
        effective_lockdown.to_string()
    };
    let focus_loss_threshold = if show_adaptive_details {
        row.focus_loss_threshold
    } else {
        None
    };
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
        lockdown_mode,
        focus_loss_threshold,
        requires_quiz_access_code,
        quiz_access_code,
        adaptive_difficulty: row.adaptive_difficulty.clone(),
        adaptive_topic_balance: row.adaptive_topic_balance,
        adaptive_stop_rule: row.adaptive_stop_rule.clone(),
        random_question_pool_count: row.random_question_pool_count,
        questions: row.questions_json.0.clone(),
        uses_server_question_sampling: false,
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
        || req.lockdown_mode.is_some()
        || req.focus_loss_threshold.is_some()
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
    if let Some(v) = &req.lockdown_mode {
        s.lockdown_mode = v.trim().to_string();
    }
    if let Some(v) = &req.focus_loss_threshold {
        s.focus_loss_threshold = *v;
    }
    s
}

fn validate_syllabus_sections(sections: &[SyllabusSection]) -> Result<(), AppError> {
    if sections.len() > MAX_SYLLABUS_SECTIONS {
        return Err(AppError::invalid_input(format!(
            "Too many sections (max {MAX_SYLLABUS_SECTIONS})."
        )));
    }
    for s in sections {
        if s.id.trim().is_empty() {
            return Err(AppError::invalid_input("Each section needs an id."));
        }
        if s.heading.len() > MAX_SYLLABUS_HEADING_LEN {
            return Err(AppError::invalid_input(
                "Section heading is too long.",
            ));
        }
        if s.markdown.len() > MAX_SYLLABUS_MARKDOWN_LEN {
            return Err(AppError::invalid_input(
                "Section content is too long.",
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
        return Err(AppError::invalid_input("Instructions are required."));
    }
    if instructions.len() > MAX_SYLLABUS_SECTION_INSTRUCTIONS_LEN {
        return Err(AppError::invalid_input(format!(
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
        return Err(AppError::invalid_input(
            "courseIds must not contain duplicates.",
        ));
    }
    if req.course_ids.len() != expected.len() || got != expected {
        return Err(AppError::invalid_input(
            "courseIds must list each catalog course exactly once.",
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
        return Err(AppError::invalid_input("Course title is required."));
    }

    let row =
        course::insert_course(&state.pool, title, req.description.trim(), user.user_id).await?;
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
        sqlx::Error::RowNotFound => AppError::invalid_input(
            "Invalid reorder: module or child ids must match the current structure.",
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
        return Err(AppError::invalid_input("Module name is required."));
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
        return Err(AppError::invalid_input("Module name is required."));
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
        return Err(AppError::invalid_input("Heading title is required."));
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
        return Err(AppError::invalid_input(
            "Assignment name is required.",
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
        return Err(AppError::invalid_input("Page name is required."));
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
        return Err(AppError::invalid_input("Quiz name is required."));
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
        return Err(AppError::invalid_input("Link title is required."));
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
        late_submission_policy: None,
        late_penalty_percent: None,
        rubric: None,
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
        return Err(AppError::invalid_input("Content is too long."));
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
        late_submission_policy: None,
        late_penalty_percent: None,
        rubric: None,
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
        return Err(AppError::invalid_input(msg));
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
        return Err(AppError::invalid_input(msg));
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
        return Err(AppError::invalid_input(msg));
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
        return Err(AppError::invalid_input(msg));
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

    let Some(row) = course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
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
        return Err(AppError::invalid_input("Content is too long."));
    }

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let Some(cur) = course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
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
    validate_assignment_late_settings(
        &merged_write.late_submission_policy,
        merged_write.late_penalty_percent,
    )?;

    if let Some(ref v) = merged_write.rubric_json {
        let r: RubricDefinition = serde_json::from_value(v.clone())
            .map_err(|_| AppError::invalid_input("Invalid rubric."))?;
        assignment_rubric::validate_rubric_definition(&r)?;
        assignment_rubric::validate_rubric_against_points_worth(&r, merged_write.points_worth)?;
    }

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

    let Some(row) = course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    Ok(Json(module_assignment_response_for_api(item_id, &row, true, None)))
}

async fn module_assignment_generate_rubric_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<GenerateAssignmentRubricRequest>,
) -> Result<Json<GenerateAssignmentRubricResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let prompt = req.prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::invalid_input("Instructions are required."));
    }
    if prompt.len() > MAX_ASSIGNMENT_RUBRIC_PROMPT_LEN {
        return Err(AppError::invalid_input("Instructions are too long."));
    }
    if let Some(ref s) = req.assignment_markdown {
        if s.len() > MAX_MODULE_CONTENT_MARKDOWN_LEN {
            return Err(AppError::invalid_input("Assignment body is too long."));
        }
    }

    let client = state
        .open_router
        .as_ref()
        .ok_or(AppError::AiNotConfigured)?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let Some(row) = course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    let model = user_ai_settings::get_course_setup_model_id(&state.pool, user.user_id).await?;

    let rubric = assignment_rubric_ai::generate_assignment_rubric(
        &state.pool,
        client.as_ref(),
        &model,
        prompt,
        &row.title,
        row.points_worth,
        req.assignment_markdown.as_deref(),
    )
    .await?;

    Ok(Json(GenerateAssignmentRubricResponse { rubric }))
}

async fn module_quiz_get_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    Query(q): Query<ModuleQuizGetQuery>,
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

    let mut resp = module_quiz_response_for_api(
        item_id,
        &row,
        can_edit,
        shift_ctx.as_ref(),
        course_row.lockdown_mode_enabled,
    );
    let attempt_for_q = if !can_edit {
        q.attempt_id
    } else {
        None
    };
    let resolved = question_bank::resolve_delivery_questions(
        &state.pool,
        course_id,
        item_id,
        course_row.question_bank_enabled,
        &row.questions_json.0,
        attempt_for_q,
        Some(user.user_id),
        can_edit,
    )
    .await?;
    resp.questions = resolved.questions;
    resp.uses_server_question_sampling = resolved.uses_server_question_sampling;
    if !can_edit {
        resp.questions = sanitize_quiz_questions_for_learner(resp.questions);
    }
    Ok(Json(resp))
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
            return Err(AppError::invalid_input("Content is too long."));
        }
    }
    if let Some(questions) = &req.questions {
        validate_quiz_questions(questions)?;
    }

    let course_row = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    let course_id = course_row.id;
    let course_bank_on = course_row.question_bank_enabled;

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
        if quiz_lockdown::parse_lockdown_mode_setting(&merged.lockdown_mode).is_none() {
            return Err(AppError::invalid_input(
                "lockdownMode must be one of: standard, one_at_a_time, kiosk.",
            ));
        }
        quiz_settings_write = Some(merged);
    }

    if let Some(title) = &req.title {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::invalid_input("Quiz title is required."));
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
        if course_bank_on {
            question_bank::sync_quiz_refs_from_editor_json(
                &state.pool,
                course_id,
                item_id,
                &questions,
                Some(user.user_id),
            )
            .await?;
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
                return Err(AppError::invalid_input(
                    "One or more adaptive source items are invalid for this course.",
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

    let eff = quiz_lockdown::effective_lockdown_mode(course_row.lockdown_mode_enabled, &row);
    if row.is_adaptive && quiz_lockdown::server_enforces_forward_lockdown(eff) {
        return Err(AppError::invalid_input(
            "Adaptive quizzes cannot use lockdown delivery modes.",
        ));
    }

    Ok(Json(module_quiz_response_for_api(
        item_id,
        &row,
        true,
        None,
        course_row.lockdown_mode_enabled,
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
        return Err(AppError::invalid_input(
            "This quiz is not configured for adaptive mode.",
        ));
    }

    if !can_edit {
        let Some(aid) = req.attempt_id else {
            return Err(AppError::invalid_input(
                "attemptId is required to take an adaptive quiz.",
            ));
        };
        let Some(att) = quiz_attempts::get_attempt(&state.pool, aid).await? else {
            return Err(AppError::NotFound);
        };
        if att.student_user_id != user.user_id
            || att.course_id != course_id
            || att.structure_item_id != item_id
            || att.status != "in_progress"
            || !att.is_adaptive
        {
            return Err(AppError::Forbidden);
        }
        accommodations::require_attempt_within_deadline(&att, Utc::now())?;
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
            return Err(AppError::invalid_input(
                "Each history entry must have choiceWeights aligned with choices.",
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

    let mastery_summary = if can_edit {
        None
    } else if learner_state::learner_model_enabled() {
        DEFAULT_LEARNER_STATE_SERVICE
            .course_mastery_summary_for_prompt(&state.pool, course_id, user.user_id)
            .await?
    } else {
        None
    };

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
        mastery_summary.as_deref(),
    )
    .await?;

    Ok(Json(AdaptiveQuizNextResponse {
        finished: false,
        questions,
        message: None,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuizResultsQuery {
    attempt_id: Option<Uuid>,
    student_user_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuizAttemptsListQuery {
    /// When omitted, lists attempts for the current user. Instructors may pass another learner id.
    user_id: Option<Uuid>,
}

fn effective_quiz_attempt_cap(
    row: &course_module_quizzes::CourseItemQuizRow,
    acc_extra: i32,
    enrollment_extra: i32,
) -> Option<i64> {
    if row.unlimited_attempts {
        None
    } else {
        Some(
            row.max_attempts as i64
                + acc_extra.max(0) as i64
                + enrollment_extra.max(0) as i64,
        )
    }
}

fn remaining_quiz_attempt_starts(
    cap: Option<i64>,
    submitted_count: i64,
    has_in_progress: bool,
) -> Option<i32> {
    let cap = cap?;
    let in_flight = if has_in_progress { 1i64 } else { 0 };
    let rem = cap - submitted_count - in_flight;
    Some(rem.max(0) as i32)
}

fn quiz_access_code_matches(
    row: &course_module_quizzes::CourseItemQuizRow,
    submitted: Option<&str>,
) -> bool {
    let expected = row
        .quiz_access_code
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    match expected {
        None => true,
        Some(sec) => submitted.map(|s| s.trim()) == Some(sec),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuizCodeRunRequest {
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    language_id: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuizCodeRunResponse {
    question_id: String,
    results: Vec<CodeExecutionResult>,
    points_earned: f64,
    points_possible: f64,
}

fn check_code_run_rate_limit(user_id: Uuid) -> Result<(), AppError> {
    let now = Utc::now();
    let cutoff = now - chrono::Duration::minutes(1);
    let lock = CODE_RUN_RATE_LIMIT.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = lock
        .lock()
        .map_err(|_| AppError::invalid_input("Rate limiter lock error."))?;
    let runs = guard.entry(user_id).or_default();
    runs.retain(|ts| *ts >= cutoff);
    if runs.len() >= CODE_RUNS_PER_MINUTE {
        return Err(AppError::TooManyRequests(
            "Rate limit exceeded for code runs (max 10 per minute).".into(),
        ));
    }
    runs.push(now);
    Ok(())
}

async fn module_quiz_start_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<QuizStartRequest>,
) -> Result<Json<QuizStartResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

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

    if !quiz_access_code_matches(&row, req.quiz_access_code.as_deref()) {
        return Err(AppError::invalid_input("Invalid quiz access code."));
    }

    let mode = quiz_lockdown::effective_lockdown_mode(course_row.lockdown_mode_enabled, &row);
    if row.is_adaptive && quiz_lockdown::server_enforces_forward_lockdown(mode) {
        return Err(AppError::invalid_input(
            "Adaptive quizzes cannot use lockdown delivery modes.",
        ));
    }

    let acc = accommodations::resolve_effective_or_default(&state.pool, user.user_id, course_id).await;
    let hints_disabled = quiz_lockdown::hints_disabled(mode) && !acc.hints_always_enabled;

    let enrollment_id = enrollment::get_student_enrollment_id(&state.pool, course_id, user.user_id)
        .await?;
    let enrollment_extra = if let Some(eid) = enrollment_id {
        enrollment_quiz_overrides::get_extra_attempts_for_enrollment_quiz(
            &state.pool,
            eid,
            item_id,
        )
        .await?
    } else {
        0
    };
    let attempt_cap = effective_quiz_attempt_cap(&row, acc.extra_attempts, enrollment_extra);

    if let Some(existing) =
        quiz_attempts::find_in_progress(&state.pool, course_id, item_id, user.user_id).await?
    {
        let submitted_count =
            quiz_attempts::count_submitted_attempts(&state.pool, course_id, item_id, user.user_id)
                .await?;
        let remaining = remaining_quiz_attempt_starts(attempt_cap, submitted_count, true);
        let max_attempts = (!row.unlimited_attempts).then_some(row.max_attempts);
        return Ok(Json(QuizStartResponse {
            attempt_id: existing.id,
            attempt_number: existing.attempt_number,
            started_at: existing.started_at,
            lockdown_mode: mode.to_string(),
            hints_disabled,
            back_navigation_allowed: quiz_lockdown::back_navigation_allowed(mode),
            current_question_index: existing.current_question_index,
            deadline_at: existing.deadline_at,
            reduced_distraction_mode: acc.reduced_distraction_mode,
            retake_policy: row.grade_attempt_policy.clone(),
            max_attempts,
            remaining_attempts: remaining,
        }));
    }

    let submitted_count =
        quiz_attempts::count_submitted_attempts(&state.pool, course_id, item_id, user.user_id)
            .await?;
    if let Some(cap) = attempt_cap {
        if submitted_count >= cap {
            tracing::warn!(
                user_id = %user.user_id,
                quiz_item_id = %item_id,
                "quiz_attempts.blocked_max_attempts"
            );
            return Err(AppError::MaxAttemptsReached);
        }
    }

    let shift_ctx =
        relative_schedule::load_shift_context_for_user(&state.pool, &course_row, user.user_id)
            .await?;
    let due_effective = quiz_attempt_grading::quiz_effective_due_at(row.due_at, shift_ctx.as_ref());
    let now = Utc::now();
    if row.late_submission_policy == "block"
        && quiz_attempt_grading::quiz_submission_is_late(due_effective, now)
    {
        return Err(AppError::invalid_input(
            "No new attempts may be started after the due date for this quiz.",
        ));
    }

    let attempt_number =
        quiz_attempts::next_attempt_number(&state.pool, course_id, item_id, user.user_id).await?;
    let (deadline_at, extended_time_applied) = accommodations::compute_attempt_deadline(
        now,
        row.time_limit_minutes,
        acc.time_multiplier,
    );
    let created = quiz_attempts::insert_attempt(
        &state.pool,
        course_id,
        item_id,
        user.user_id,
        attempt_number,
        row.is_adaptive,
        deadline_at,
        extended_time_applied,
    )
    .await?;

    if acc.has_operational_settings() {
        accommodations::log_accommodation_applied(
            user.user_id,
            item_id,
            &accommodations::instructor_flag_labels(&acc),
        );
    }

    if course_row.question_bank_enabled && !row.is_adaptive {
        let refs = qb_repo::list_quiz_question_refs(&state.pool, item_id).await?;
        if !refs.is_empty() {
            if let Err(e) = question_bank::materialize_attempt_questions(
                &state.pool,
                course_id,
                item_id,
                created.id,
                user.user_id,
                &refs,
                row.shuffle_questions,
                row.shuffle_choices,
            )
            .await
            {
                let _ = quiz_attempts::delete_attempt(&state.pool, created.id).await;
                return Err(e);
            }
        }
    }

    let remaining = remaining_quiz_attempt_starts(attempt_cap, submitted_count, true);
    let max_attempts = (!row.unlimited_attempts).then_some(row.max_attempts);

    Ok(Json(QuizStartResponse {
        attempt_id: created.id,
        attempt_number: created.attempt_number,
        started_at: created.started_at,
        lockdown_mode: mode.to_string(),
        hints_disabled,
        back_navigation_allowed: quiz_lockdown::back_navigation_allowed(mode),
        current_question_index: created.current_question_index,
        deadline_at: created.deadline_at,
        reduced_distraction_mode: acc.reduced_distraction_mode,
        retake_policy: row.grade_attempt_policy.clone(),
        max_attempts,
        remaining_attempts: remaining,
    }))
}

async fn module_quiz_submit_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<QuizSubmitRequest>,
) -> Result<Json<QuizSubmitResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

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

    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    let body = quiz_submission::submit_module_quiz(
        &state.pool,
        &course_row,
        course_id,
        item_id,
        user.user_id,
        &quiz_row,
        &req,
    )
    .await?;
    Ok(Json(body))
}

async fn module_quiz_results_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    Query(q): Query<QuizResultsQuery>,
    headers: HeaderMap,
) -> Result<Json<QuizResultsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;

    let target_user = if let Some(sid) = q.student_user_id {
        if !can_edit {
            return Err(AppError::Forbidden);
        }
        sid
    } else {
        user.user_id
    };

    if !can_edit && target_user != user.user_id {
        return Err(AppError::Forbidden);
    }

    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    let shift_ctx = if !can_edit {
        relative_schedule::load_shift_context_for_user(&state.pool, &course_row, user.user_id).await?
    } else {
        None
    };
    let due_at = match shift_ctx.as_ref() {
        Some(ctx) => relative_schedule::shift_opt(ctx, quiz_row.due_at),
        None => quiz_row.due_at,
    };

    let now = Utc::now();

    if !can_edit {
        match quiz_row.review_when.as_str() {
            "never" => return Err(AppError::Forbidden),
            "after_due" => {
                if let Some(d) = due_at {
                    if now < d {
                        return Err(AppError::Forbidden);
                    }
                }
            }
            _ => {}
        }
    }

    let attempt = if let Some(aid) = q.attempt_id {
        quiz_attempts::get_attempt(&state.pool, aid).await?
    } else {
        quiz_attempts::latest_submitted_attempt(&state.pool, course_id, item_id, target_user).await?
    }
    .ok_or(AppError::NotFound)?;

    if attempt.course_id != course_id
        || attempt.structure_item_id != item_id
        || attempt.student_user_id != target_user
        || attempt.status != "submitted"
    {
        return Err(AppError::NotFound);
    }

    let rows = quiz_attempts::list_responses(&state.pool, attempt.id).await?;
    let resolved = question_bank::resolve_delivery_questions(
        &state.pool,
        course_id,
        item_id,
        course_row.question_bank_enabled,
        &quiz_row.questions_json.0,
        Some(attempt.id),
        Some(target_user),
        false,
    )
    .await?;
    let bank: Vec<QuizQuestion> = resolved.questions;
    let mut bank_by_id: HashMap<String, QuizQuestion> = HashMap::new();
    for q in bank {
        bank_by_id.insert(q.id.clone(), q);
    }

    let vis = quiz_row.review_visibility.as_str();
    let show_score = can_edit
        || (quiz_row.show_score_timing != "manual"
            && vis != "none");
    let show_questions = can_edit || !matches!(vis, "none" | "score_only");

    let score = if show_score {
        Some(QuizResultsScoreSummary {
            points_earned: attempt.points_earned.unwrap_or(0.0),
            points_possible: attempt.points_possible.unwrap_or(0.0),
            score_percent: attempt.score_percent.unwrap_or(0.0),
        })
    } else {
        None
    };

    let questions = if show_questions {
        let include_correct = can_edit || matches!(vis, "correct_answers" | "full");
        let mut out: Vec<QuizResultsQuestionResult> = Vec::new();
        for r in rows {
            let correct_idx = if !attempt.is_adaptive && include_correct {
                r.question_id
                    .as_ref()
                    .and_then(|id| bank_by_id.get(id))
                    .and_then(|q| q.correct_choice_index)
            } else {
                None
            };
            out.push(QuizResultsQuestionResult {
                question_index: r.question_index,
                question_id: r.question_id,
                question_type: r.question_type,
                prompt_snapshot: r.prompt_snapshot,
                response_json: r.response_json,
                is_correct: r.is_correct,
                points_awarded: r.points_awarded,
                max_points: r.max_points,
                correct_choice_index: correct_idx,
            });
        }
        Some(out)
    } else {
        None
    };

    Ok(Json(QuizResultsResponse {
        attempt_id: attempt.id,
        attempt_number: attempt.attempt_number,
        started_at: attempt.started_at,
        academic_integrity_flag: attempt.academic_integrity_flag,
        submitted_at: attempt.submitted_at,
        status: attempt.status,
        is_adaptive: attempt.is_adaptive,
        extended_time_active: attempt.extended_time_applied,
        score,
        questions,
    }))
}

async fn module_quiz_attempts_list_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    Query(q): Query<QuizAttemptsListQuery>,
    headers: HeaderMap,
) -> Result<Json<QuizAttemptsListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;

    let target_user = q.user_id.unwrap_or(user.user_id);
    if target_user != user.user_id && !can_edit {
        return Err(AppError::Forbidden);
    }

    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };

    let attempts = quiz_attempts::list_submitted_attempts_for_item_student(
        &state.pool,
        course_id,
        item_id,
        target_user,
    )
    .await?;
    let policy_score_percent = quiz_attempt_grading::pick_policy_points(
        &attempts,
        &quiz_row.grade_attempt_policy,
    )
    .and_then(|(e, p)| quiz_attempt_grading::policy_score_percent(e, p));

    let mut out: Vec<QuizAttemptSummary> = Vec::with_capacity(attempts.len());
    for a in attempts {
        let submitted_at = a.submitted_at.unwrap_or(a.started_at);
        out.push(QuizAttemptSummary {
            id: a.id,
            attempt_number: a.attempt_number,
            submitted_at,
            score_percent: a.score_percent,
            points_earned: a.points_earned.unwrap_or(0.0),
            points_possible: a.points_possible.unwrap_or(0.0),
        });
    }

    Ok(Json(QuizAttemptsListResponse {
        attempts: out,
        policy_score_percent,
        retake_policy: quiz_row.grade_attempt_policy.clone(),
    }))
}

async fn enrollment_quiz_override_upsert_handler(
    State(state): State<AppState>,
    Path((course_code, enrollment_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<EnrollmentQuizOverrideUpsertRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let Some(enr) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    if enr.course_id != course_id {
        return Err(AppError::NotFound);
    }

    let Some(_) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, req.quiz_id).await?
    else {
        return Err(AppError::NotFound);
    };

    if !(0..=500).contains(&req.extra_attempts) {
        return Err(AppError::invalid_input(
            "extraAttempts must be between 0 and 500.",
        ));
    }
    if let Some(m) = req.time_multiplier {
        if !m.is_finite() || m < 1.0 {
            return Err(AppError::invalid_input(
                "timeMultiplier must be at least 1.0.",
            ));
        }
    }

    enrollment_quiz_overrides::upsert_override(
        &state.pool,
        enrollment_id,
        req.quiz_id,
        user.user_id,
        &enrollment_quiz_overrides::EnrollmentQuizOverrideWrite {
            extra_attempts: req.extra_attempts,
            time_multiplier: req.time_multiplier,
        },
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn enrollment_quiz_override_delete_handler(
    State(state): State<AppState>,
    Path((course_code, enrollment_id, item_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let Some(enr) = enrollment::get_enrollment_by_id(&state.pool, enrollment_id).await? else {
        return Err(AppError::NotFound);
    };
    if enr.course_id != course_id {
        return Err(AppError::NotFound);
    }

    let ok =
        enrollment_quiz_overrides::delete_override(&state.pool, enrollment_id, item_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
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
        return Err(AppError::invalid_input("Prompt is required."));
    }
    if prompt.len() > MAX_QUIZ_GENERATION_PROMPT_LEN {
        return Err(AppError::invalid_input("Prompt is too long."));
    }
    if req.question_count < MIN_QUIZ_GENERATION_COUNT
        || req.question_count > MAX_QUIZ_GENERATION_COUNT
    {
        return Err(AppError::invalid_input(format!(
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

    let assignment_ids: Vec<Uuid> = items
        .iter()
        .filter(|it| it.kind == "assignment")
        .map(|it| it.id)
        .collect();
    let rubric_map =
        course_module_assignments::rubrics_for_structure_items(pool, course_id, &assignment_ids)
            .await?;

    let columns: Vec<CourseGradebookGridColumn> = items
        .into_iter()
        .filter(|it| it.kind == "assignment" || it.kind == "quiz")
        .map(|it| {
            let max_points = gradebook_max_points(&it);
            let rubric = if it.kind == "assignment" {
                rubric_map
                    .get(&it.id)
                    .cloned()
                    .flatten()
                    .and_then(|v| serde_json::from_value(v).ok())
            } else {
                None
            };
            CourseGradebookGridColumn {
                id: it.id,
                kind: it.kind,
                title: it.title,
                max_points,
                assignment_group_id: it.assignment_group_id,
                rubric,
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
    let cleaned: String = t.chars().filter(|c| *c != ',' && !c.is_whitespace()).collect();
    let n: f64 = cleaned
        .parse()
        .map_err(|_| AppError::invalid_input("Each score must be a valid number."))?;
    if !n.is_finite() || n < 0.0 {
        return Err(AppError::invalid_input(
            "Each score must be a non-negative number.",
        ));
    }
    Ok(Some(n))
}

fn ensure_points_within_max(points: f64, max_points: Option<i32>) -> Result<(), AppError> {
    if let Some(m) = max_points {
        if m > 0 && points > m as f64 + 1e-6 {
            return Err(AppError::invalid_input(format!(
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
    let (grades, rubric_scores) = course_grades::list_for_course(&state.pool, course_id).await?;

    Ok(Json(CourseGradebookGridResponse {
        students,
        columns,
        grades,
        rubric_scores,
    }))
}

async fn my_grades_get_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseMyGradesResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let (course_id, students, columns) =
        gradebook_students_and_columns(&state.pool, &course_code).await?;

    let is_student = students.iter().any(|s| s.user_id == user.user_id);
    if !is_student {
        return Err(AppError::Forbidden);
    }

    let (all_grades, _) = course_grades::list_for_course(&state.pool, course_id).await?;
    let grades = all_grades
        .get(&user.user_id)
        .cloned()
        .unwrap_or_default();

    let assignment_groups = course_grading::get_settings_for_course_code(&state.pool, &course_code)
        .await?
        .map(|s| s.assignment_groups)
        .unwrap_or_default();

    Ok(Json(CourseMyGradesResponse {
        columns,
        grades,
        assignment_groups,
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
    let rubric_by_item: HashMap<Uuid, RubricDefinition> = columns
        .iter()
        .filter_map(|c| c.rubric.clone().map(|r| (c.id, r)))
        .collect();

    let mut ops: Vec<(Uuid, Uuid, Option<f64>, Option<HashMap<Uuid, f64>>)> = Vec::new();

    for (user_id, row) in req.grades {
        if !student_ok.contains(&user_id) {
            return Err(AppError::invalid_input(
                "Grades include a user who is not enrolled as a student in this course.",
            ));
        }
        for (item_id, raw) in row {
            let Some(max_p) = item_meta.get(&item_id).copied() else {
                return Err(AppError::invalid_input(
                    "Grades include a module item that is not part of this course gradebook.",
                ));
            };
            let parsed = parse_gradebook_points_str(&raw)?;
            let rubric_scores_cell = req
                .rubric_scores
                .get(&user_id)
                .and_then(|m| m.get(&item_id));

            if let Some(rubric) = rubric_by_item.get(&item_id) {
                if let Some(scores) = rubric_scores_cell {
                    if !scores.is_empty() {
                        let total = assignment_rubric::validate_rubric_scores_for_grade(rubric, scores)?;
                        ensure_points_within_max(total, max_p)?;
                        if let Some(p) = parsed {
                            if (p - total).abs() > 1e-3 {
                                return Err(AppError::invalid_input(
                                    "Rubric total must match the score entered for this cell.",
                                ));
                            }
                        }
                        ops.push((user_id, item_id, Some(total), Some(scores.clone())));
                        continue;
                    }
                }
            }

            match parsed {
                None => ops.push((user_id, item_id, None, None)),
                Some(p) => {
                    ensure_points_within_max(p, max_p)?;
                    ops.push((user_id, item_id, Some(p), None));
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
        return Err(AppError::invalid_input("Invalid grading scale."));
    }

    for g in &req.assignment_groups {
        if g.name.trim().is_empty() {
            return Err(AppError::invalid_input(
                "Each assignment group needs a name.",
            ));
        }
        if !g.weight_percent.is_finite() || g.weight_percent < 0.0 || g.weight_percent > 100.0 {
            return Err(AppError::invalid_input(
                "Weights must be between 0 and 100.",
            ));
        }
    }

    match course_grading::put_settings(&state.pool, &course_code, scale, &req.assignment_groups)
        .await
    {
        Ok(Some(row)) => Ok(Json(row)),
        Ok(None) => Err(AppError::NotFound),
        Err(PutError::UnknownGroupId(id)) => Err(AppError::invalid_input(format!(
            "Unknown assignment group id: {id}"
        ))),
        Err(PutError::Db(e)) => Err(e.into()),
    }
}

async fn require_course_outcomes_edit(
    state: &AppState,
    course_code: &str,
    user_id: Uuid,
) -> Result<Uuid, AppError> {
    require_course_access(state, course_code, user_id).await?;
    let required = course_grants::course_item_create_permission(course_code);
    assert_permission(&state.pool, user_id, &required).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    Ok(course_id)
}

async fn course_outcomes_list_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<CourseOutcomesListResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id = require_course_outcomes_edit(&state, &course_code, user.user_id).await?;

    let students = enrollment::list_student_users_for_course_code(&state.pool, &course_code).await?;
    let enrolled = students.len() as i32;

    let rows = course_outcomes::list_outcomes(&state.pool, course_id).await?;
    let link_rows = course_outcomes::list_links_for_course(&state.pool, course_id).await?;

    let mut links_by_outcome: HashMap<Uuid, Vec<&course_outcomes::OutcomeLinkWithItemRow>> =
        HashMap::new();
    for lr in &link_rows {
        links_by_outcome.entry(lr.outcome_id).or_default().push(lr);
    }

    let mut outcomes_out = Vec::with_capacity(rows.len());
    for o in rows {
        let empty: Vec<&course_outcomes::OutcomeLinkWithItemRow> = Vec::new();
        let links_for_o = links_by_outcome.get(&o.id).unwrap_or(&empty);

        let mut link_apis: Vec<CourseOutcomeLinkApi> = Vec::new();

        for lr in links_for_o {
            let progress = match lr.target_kind.as_str() {
                "quiz_question" => {
                    course_outcomes::progress_for_quiz_question(
                        &state.pool,
                        course_id,
                        lr.structure_item_id,
                        lr.quiz_question_id.trim(),
                        enrolled,
                    )
                    .await?
                }
                "assignment" | "quiz" => {
                    course_outcomes::progress_for_graded_item(
                        &state.pool,
                        course_id,
                        lr.structure_item_id,
                        lr.item_kind.as_str(),
                        enrolled,
                    )
                    .await?
                }
                _ => course_outcomes::OutcomeLinkProgress {
                    avg_score_percent: None,
                    graded_learners: 0,
                    enrolled_learners: enrolled,
                },
            };
            link_apis.push(CourseOutcomeLinkApi {
                id: lr.id,
                structure_item_id: lr.structure_item_id,
                target_kind: lr.target_kind.clone(),
                quiz_question_id: lr.quiz_question_id.clone(),
                measurement_level: lr.measurement_level.clone(),
                intensity_level: lr.intensity_level.clone(),
                item_title: lr.item_title.clone(),
                item_kind: lr.item_kind.clone(),
                progress,
            });
        }

        let rollup_avg_score_percent = outcomes_service::rollup_avg_for_outcome_links(&link_apis);

        outcomes_out.push(CourseOutcomeApi {
            id: o.id,
            title: o.title,
            description: o.description,
            sort_order: o.sort_order,
            rollup_avg_score_percent,
            links: link_apis,
        });
    }

    Ok(Json(CourseOutcomesListResponse {
        enrolled_learners: enrolled,
        outcomes: outcomes_out,
    }))
}

async fn course_outcomes_create_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PostCourseOutcomeRequest>,
) -> Result<Json<CourseOutcomeApi>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id = require_course_outcomes_edit(&state, &course_code, user.user_id).await?;

    let title = req.title.trim();
    if title.is_empty() {
        return Err(AppError::invalid_input("Title is required."));
    }
    if title.len() > 500 {
        return Err(AppError::invalid_input("Title is too long."));
    }
    if req.description.len() > 20_000 {
        return Err(AppError::invalid_input("Description is too long."));
    }

    let row = course_outcomes::insert_outcome(
        &state.pool,
        course_id,
        title,
        req.description.trim(),
    )
    .await?;

    Ok(Json(CourseOutcomeApi {
        id: row.id,
        title: row.title,
        description: row.description,
        sort_order: row.sort_order,
        rollup_avg_score_percent: None,
        links: vec![],
    }))
}

async fn course_outcomes_patch_handler(
    State(state): State<AppState>,
    Path((course_code, outcome_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PatchCourseOutcomeRequest>,
) -> Result<Json<CourseOutcomeApi>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id = require_course_outcomes_edit(&state, &course_code, user.user_id).await?;

    if let Some(ref t) = req.title {
        let t = t.trim();
        if t.is_empty() {
            return Err(AppError::invalid_input("Title cannot be empty."));
        }
        if t.len() > 500 {
            return Err(AppError::invalid_input("Title is too long."));
        }
    }
    if let Some(ref d) = req.description {
        if d.len() > 20_000 {
            return Err(AppError::invalid_input("Description is too long."));
        }
    }

    let Some(updated) = course_outcomes::update_outcome(
        &state.pool,
        course_id,
        outcome_id,
        req.title.as_deref(),
        req.description.as_deref(),
    )
    .await?
    else {
        return Err(AppError::NotFound);
    };

    let enrolled =
        enrollment::list_student_users_for_course_code(&state.pool, &course_code).await?.len() as i32;
    let link_rows =
        course_outcomes::list_links_for_outcome(&state.pool, course_id, outcome_id).await?;

    let mut link_apis = Vec::new();
    for lr in &link_rows {
        let progress = match lr.target_kind.as_str() {
            "quiz_question" => {
                course_outcomes::progress_for_quiz_question(
                    &state.pool,
                    course_id,
                    lr.structure_item_id,
                    lr.quiz_question_id.trim(),
                    enrolled,
                )
                .await?
            }
            "assignment" | "quiz" => {
                course_outcomes::progress_for_graded_item(
                    &state.pool,
                    course_id,
                    lr.structure_item_id,
                    lr.item_kind.as_str(),
                    enrolled,
                )
                .await?
            }
            _ => course_outcomes::OutcomeLinkProgress {
                avg_score_percent: None,
                graded_learners: 0,
                enrolled_learners: enrolled,
            },
        };
        link_apis.push(CourseOutcomeLinkApi {
            id: lr.id,
            structure_item_id: lr.structure_item_id,
            target_kind: lr.target_kind.clone(),
            quiz_question_id: lr.quiz_question_id.clone(),
            measurement_level: lr.measurement_level.clone(),
            intensity_level: lr.intensity_level.clone(),
            item_title: lr.item_title.clone(),
            item_kind: lr.item_kind.clone(),
            progress,
        });
    }

    let rollup_avg_score_percent = outcomes_service::rollup_avg_for_outcome_links(&link_apis);

    Ok(Json(CourseOutcomeApi {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        sort_order: updated.sort_order,
        rollup_avg_score_percent,
        links: link_apis,
    }))
}

async fn course_outcomes_delete_handler(
    State(state): State<AppState>,
    Path((course_code, outcome_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id = require_course_outcomes_edit(&state, &course_code, user.user_id).await?;

    let ok = course_outcomes::delete_outcome(&state.pool, course_id, outcome_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn course_outcomes_add_link_handler(
    State(state): State<AppState>,
    Path((course_code, outcome_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<PostCourseOutcomeLinkRequest>,
) -> Result<Json<CourseOutcomeLinkApi>, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id = require_course_outcomes_edit(&state, &course_code, user.user_id).await?;

    let body = outcomes_service::add_outcome_link(
        &state.pool,
        course_id,
        &course_code,
        outcome_id,
        &req,
    )
    .await?;
    Ok(Json(body))
}

async fn course_outcomes_delete_link_handler(
    State(state): State<AppState>,
    Path((course_code, outcome_id, link_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    let course_id = require_course_outcomes_edit(&state, &course_code, user.user_id).await?;

    let ok = course_outcomes::delete_link(&state.pool, course_id, outcome_id, link_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
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
        return Err(AppError::invalid_input(
            "Archived module items cannot be rescheduled from the calendar.",
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
            return Err(AppError::invalid_input(
                "Only content pages, assignments, and quizzes support a due date.",
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
        return Err(AppError::invalid_input(
            "Provide title, published, and/or archived.",
        ));
    }

    let title_opt: Option<&str> = match &req.title {
        None => None,
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Err(AppError::invalid_input("Title cannot be empty."));
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
        return Err(AppError::invalid_input(
            "Only content pages, assignments, and quizzes can belong to an assignment group.",
        ));
    }

    if let Some(gid) = req.assignment_group_id {
        if !course_grading::group_belongs_to_course(&state.pool, course_id, gid).await? {
            return Err(AppError::invalid_input(
                "That assignment group does not belong to this course.",
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
    let viewer_student_enrollment_id =
        enrollment::get_student_enrollment_id(&state.pool, row.id, user.user_id).await?;
    Ok(Json(CourseWithViewerResponse {
        course: row,
        viewer_enrollment_roles,
        viewer_student_enrollment_id,
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

    course_export_import::apply_import(&state.pool, &course_code, req.mode, &req.export, None)
        .await?;
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
        AppError::InvalidInput { message, .. } => message.clone(),
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

async fn handle_canvas_import_ws(
    mut socket: WebSocket,
    state: AppState,
    course_code: String,
) {
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
        include: canvas_include,
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
                .map_err(|e| {
                    AppError::invalid_input(format!("Could not start HTTP client: {e}"))
                })?;

            let export = canvas_course_import::build_export_from_canvas_wire(
                &client,
                &canvas_base_url,
                &canvas_course_id,
                &access_token,
                canvas_include,
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

            course_export_import::apply_import(
                &pool,
                &course_code_worker,
                mode,
                &export,
                Some(&canvas_include),
            )
            .await?;
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
        return Err(AppError::invalid_input(
            "Enrollment groups are not enabled for this course.",
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
        return Err(AppError::invalid_input(
            "Enrollment groups are not enabled for this course.",
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
        return Err(AppError::invalid_input("Group set name is required."));
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
        return Err(AppError::invalid_input("Group set name is required."));
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
        return Err(AppError::invalid_input("Group name is required."));
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
        return Err(AppError::invalid_input("Group name is required."));
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
        return Err(AppError::invalid_input(
            "Only student enrollments can be assigned to groups.",
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
        return Err(AppError::invalid_input(
            "Enrollment or group is not part of this course.",
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
        (None, None) => Err(AppError::invalid_input(
            "Send appRoleId or role (\"student\").",
        )),
        (Some(_), Some(_)) => Err(AppError::invalid_input(
            "Send only one of appRoleId or role.",
        )),
        (None, Some(role_val)) => {
            if role_val != "student" {
                return Err(AppError::invalid_input(
                    "Only role: \"student\" is supported.",
                ));
            }
            let Some(row) =
                enrollment::get_enrollment_for_patch(&state.pool, &course_code, enrollment_id)
                    .await?
            else {
                return Err(AppError::NotFound);
            };
            if row.role == "teacher" {
                return Err(AppError::invalid_input(
                    "The teacher enrollment cannot be changed here.",
                ));
            }
            if row.role != "instructor" {
                return Err(AppError::invalid_input(
                    "Only instructor enrollments can be demoted to student.",
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
                return Err(AppError::invalid_input(
                    "The teacher enrollment cannot be changed here.",
                ));
            }
            let Some(role_row) = rbac::get_role(&state.pool, app_role_id).await? else {
                return Err(AppError::invalid_input("Unknown role."));
            };
            if role_row.scope != "course" {
                return Err(AppError::invalid_input(
                    "Only course-scoped roles can be used when setting a course role.",
                ));
            }

            let target_roles =
                enrollment::user_roles_in_course(&state.pool, &course_code, row.user_id).await?;
            if target_roles.iter().any(|r| r == "teacher") {
                return Err(AppError::invalid_input(
                    "This person's teacher enrollment can't be updated this way.",
                ));
            }
            if row.role == "student" && target_roles.iter().any(|r| r == "instructor") {
                return Err(AppError::invalid_input(
                    "This person already has instructor access in this course.",
                ));
            }
            if enrollment::user_is_course_creator(&state.pool, &course_code, row.user_id).await? {
                return Err(AppError::invalid_input(
                    "The course creator's enrollment can't be changed this way.",
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
        enrollment::EnrollmentDeleteOutcome::CannotRemoveHighestRole => Err(AppError::invalid_input(
            "You can't remove this enrollment while it's the person's primary role in the course.",
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

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let body = enrollments_service::add_enrollments(
        &state.pool,
        &course_code,
        course_id,
        user.user_id,
        &req,
    )
    .await?;
    Ok(Json(body))
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
        return Err(AppError::invalid_input(
            "Unknown markdown theme preset.",
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

async fn patch_course_features_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Json(req): Json<PatchCourseFeaturesRequest>,
) -> Result<Json<CoursePublic>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let existing = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    let standards_alignment_enabled = req
        .standards_alignment_enabled
        .unwrap_or(existing.standards_alignment_enabled);
    let adaptive_paths_enabled = req
        .adaptive_paths_enabled
        .unwrap_or(existing.adaptive_paths_enabled);
    let srs_enabled = req.srs_enabled.unwrap_or(existing.srs_enabled);

    let row = course::patch_course_features(
        &state.pool,
        &course_code,
        req.notebook_enabled,
        req.feed_enabled,
        req.calendar_enabled,
        req.question_bank_enabled,
        req.lockdown_mode_enabled,
        standards_alignment_enabled,
        adaptive_paths_enabled,
        srs_enabled,
    )
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseStandardsCoverageQuery {
    framework: String,
    #[serde(default)]
    grade: Option<String>,
}

async fn course_standards_coverage_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Query(q): Query<CourseStandardsCoverageQuery>,
) -> Result<Json<CourseStandardsCoverageResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let can_manage = rbac::user_has_permission(
        &state.pool,
        user.user_id,
        &course_grants::course_item_create_permission(&course_code),
    )
    .await?;
    let can_gradebook = rbac::user_has_permission(
        &state.pool,
        user.user_id,
        &course_grants::course_gradebook_view_permission(&course_code),
    )
    .await?;
    if !can_manage && !can_gradebook {
        return Err(AppError::Forbidden);
    }

    let course_row = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;
    if !course_row.standards_alignment_enabled {
        return Err(AppError::Forbidden);
    }

    let rows = standards_service::course_standards_coverage(
        &state.pool,
        course_row.id,
        q.framework.trim(),
        q.grade.as_deref().map(str::trim),
    )
    .await?;
    let total = rows.len() as f64;
    let covered = rows
        .iter()
        .filter(|r| r.coverage_status == "covered")
        .count() as f64;
    let coverage_pct = if total > 0.0 {
        (covered / total) * 100.0
    } else {
        0.0
    };
    tracing::info!(
        target = "standards_alignment",
        course_id = %course_row.id,
        coverage_pct,
        framework = %q.framework,
        "standards.coverage_reported"
    );

    Ok(Json(CourseStandardsCoverageResponse {
        standards: rows.into_iter().map(Into::into).collect(),
    }))
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
        return Err(AppError::invalid_input("Course title is required."));
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
        return Err(AppError::invalid_input("Invalid scheduleMode."));
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
    relative_schedule::parse_iso8601_duration(t).map_err(|m| AppError::invalid_input(m))?;
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
        return Err(AppError::invalid_input(
            "Describe the image you want.",
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
        return Err(AppError::invalid_input(
            "Provide imageUrl and/or objectPosition.",
        ));
    }

    let current = course::get_by_course_code(&state.pool, &course_code)
        .await?
        .ok_or(AppError::NotFound)?;

    let new_url = match &req.image_url {
        None => current.hero_image_url.clone().ok_or_else(|| {
            AppError::invalid_input("Set a hero image before adjusting position.")
        })?,
        Some(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Err(AppError::invalid_input("Image URL cannot be empty."));
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

async fn quiz_attempt_current_question_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, attempt_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<QuizCurrentQuestionResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    let Some(att) = quiz_attempts::get_attempt(&state.pool, attempt_id).await? else {
        return Err(AppError::NotFound);
    };
    if att.student_user_id != user.user_id
        || att.course_id != course_id
        || att.structure_item_id != item_id
        || att.status != "in_progress"
    {
        return Err(AppError::Forbidden);
    }

    accommodations::require_attempt_within_deadline(&att, Utc::now())?;

    let mode = quiz_lockdown::effective_lockdown_mode(course_row.lockdown_mode_enabled, &quiz_row);
    if !quiz_lockdown::server_enforces_forward_lockdown(mode) {
        return Err(AppError::invalid_input(
            "This endpoint is only used for lockdown-mode quizzes.",
        ));
    }

    let resolved = question_bank::resolve_delivery_questions(
        &state.pool,
        course_id,
        item_id,
        course_row.question_bank_enabled,
        &quiz_row.questions_json.0,
        Some(att.id),
        Some(user.user_id),
        false,
    )
    .await?;
    let bank = sanitize_quiz_questions_for_learner(resolved.questions);
    let total = bank.len();
    let idx = att.current_question_index as usize;
    if idx >= total {
        return Ok(Json(QuizCurrentQuestionResponse {
            question: None,
            question_index: att.current_question_index,
            total_questions: total,
            completed: true,
        }));
    }
    Ok(Json(QuizCurrentQuestionResponse {
        question: bank.get(idx).cloned(),
        question_index: att.current_question_index,
        total_questions: total,
        completed: false,
    }))
}

async fn quiz_attempt_question_run_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, attempt_id, question_id)): Path<(String, Uuid, Uuid, String)>,
    headers: HeaderMap,
    Json(body): Json<QuizCodeRunRequest>,
) -> Result<Json<QuizCodeRunResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    check_code_run_rate_limit(user.user_id)?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;
    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    let Some(att) = quiz_attempts::get_attempt(&state.pool, attempt_id).await? else {
        return Err(AppError::NotFound);
    };
    if att.student_user_id != user.user_id
        || att.course_id != course_id
        || att.structure_item_id != item_id
        || att.status != "in_progress"
    {
        return Err(AppError::Forbidden);
    }
    accommodations::require_attempt_within_deadline(&att, Utc::now())?;

    let resolved = question_bank::resolve_delivery_questions(
        &state.pool,
        course_id,
        item_id,
        course_row.question_bank_enabled,
        &quiz_row.questions_json.0,
        Some(att.id),
        Some(user.user_id),
        false,
    )
    .await?;
    let Some(q) = resolved
        .questions
        .iter()
        .find(|q| q.id == question_id && q.question_type == "code")
    else {
        return Err(AppError::invalid_input(
            "This question is not a runnable code question.",
        ));
    };
    let test_cases = quiz_submission::parse_code_test_cases(q)
        .into_iter()
        .filter(|tc| !tc.is_hidden)
        .collect::<Vec<_>>();
    if test_cases.is_empty() {
        return Err(AppError::invalid_input(
            "No public test cases are configured for this question.",
        ));
    }
    let source_code = body.code.unwrap_or_default();
    code_execution::validate_code_submission_size(&source_code)?;
    let language_id = body
        .language_id
        .or_else(|| q.type_config.get("languageId").and_then(|v| v.as_i64()).map(|v| v as i32))
        .or_else(|| {
            q.type_config
                .get("language")
                .and_then(|v| v.as_str())
                .map(code_execution::language_id_from_name)
        })
        .unwrap_or(63);

    let mut results = Vec::with_capacity(test_cases.len());
    let mut passed = 0usize;
    for tc in test_cases {
        let res = code_execution::run_code(ExecuteCodeRequest {
            language_id,
            source_code: source_code.clone(),
            stdin: tc.input,
            expected_output: tc.expected_output,
            time_limit_ms: tc.time_limit_ms,
            memory_limit_kb: tc.memory_limit_kb,
        })
        .await?;
        if res.passed {
            passed += 1;
        }
        results.push(res);
    }
    let points_possible = if q.points < 0 { 0.0 } else { q.points as f64 };
    let points_earned = if results.is_empty() {
        0.0
    } else {
        points_possible * (passed as f64 / results.len() as f64)
    };
    Ok(Json(QuizCodeRunResponse {
        question_id,
        results,
        points_earned,
        points_possible,
    }))
}

async fn quiz_attempt_advance_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, attempt_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<QuizQuestionResponseItem>,
) -> Result<Json<QuizAdvanceResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    let Some(att) = quiz_attempts::get_attempt(&state.pool, attempt_id).await? else {
        return Err(AppError::NotFound);
    };
    if att.student_user_id != user.user_id
        || att.course_id != course_id
        || att.structure_item_id != item_id
        || att.status != "in_progress"
    {
        return Err(AppError::Forbidden);
    }

    accommodations::require_attempt_within_deadline(&att, Utc::now())?;

    let mode = quiz_lockdown::effective_lockdown_mode(course_row.lockdown_mode_enabled, &quiz_row);
    if !quiz_lockdown::server_enforces_forward_lockdown(mode) {
        return Err(AppError::invalid_input(
            "Advance is only available for lockdown-mode quizzes.",
        ));
    }

    let resolved = question_bank::resolve_delivery_questions(
        &state.pool,
        course_id,
        item_id,
        course_row.question_bank_enabled,
        &quiz_row.questions_json.0,
        Some(att.id),
        Some(user.user_id),
        false,
    )
    .await?;
    let bank = &resolved.questions;
    let cur = att.current_question_index;
    let cur_usize = cur as usize;
    if cur_usize >= bank.len() {
        return Err(AppError::invalid_input(
            "There is no current question to answer for this attempt.",
        ));
    }
    let q = &bank[cur_usize];
    if body.question_id != q.id {
        return Err(AppError::invalid_input(
            "The answer does not match the current question.",
        ));
    }

    if quiz_attempts::response_is_locked(&state.pool, att.id, cur).await? {
        return Err(AppError::QuestionAlreadyLocked);
    }

    let (pts, max_pts, is_ok) = quiz_submission::grade_question_with_code_support(q, &body).await?;
    let rj = serde_json::json!({
        "selectedChoiceIndex": body.selected_choice_index,
        "selectedChoiceIndices": body.selected_choice_indices,
        "textAnswer": body.text_answer,
        "matchingPairs": &body.matching_pairs,
        "orderingSequence": &body.ordering_sequence,
        "hotspotClick": &body.hotspot_click,
        "numericValue": &body.numeric_value,
        "formulaLatex": &body.formula_latex,
        "codeSubmission": &body.code_submission,
        "fileKey": &body.file_key,
        "audioKey": &body.audio_key,
        "videoKey": &body.video_key,
    });

    let mut tx = state.pool.begin().await?;
    quiz_attempts::insert_response(
        &mut *tx,
        att.id,
        cur,
        Some(q.id.as_str()),
        &q.question_type,
        Some(q.prompt.as_str()),
        &rj,
        is_ok,
        Some(pts),
        max_pts,
        true,
    )
    .await
    .map_err(|e: sqlx::Error| {
        if let sqlx::Error::Database(ref db) = e {
            if db.code().as_deref() == Some("23505") {
                return AppError::QuestionAlreadyLocked;
            }
        }
        AppError::Db(e)
    })?;

    if !quiz_attempts::bump_current_question_index(&mut *tx, att.id, cur).await? {
        return Err(AppError::invalid_input(
            "Could not advance this attempt. Refresh and try again.",
        ));
    }
    tx.commit().await?;

    let new_idx = cur + 1;
    let completed = new_idx as usize >= bank.len();
    Ok(Json(QuizAdvanceResponse {
        locked: true,
        current_question_index: new_idx,
        completed,
    }))
}

async fn quiz_attempt_focus_loss_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, attempt_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<QuizFocusLossRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    let Some(att) = quiz_attempts::get_attempt(&state.pool, attempt_id).await? else {
        return Err(AppError::NotFound);
    };
    if att.student_user_id != user.user_id
        || att.course_id != course_id
        || att.structure_item_id != item_id
        || att.status != "in_progress"
    {
        return Err(AppError::Forbidden);
    }

    let mode = quiz_lockdown::effective_lockdown_mode(course_row.lockdown_mode_enabled, &quiz_row);
    if mode != quiz_lockdown::LOCKDOWN_KIOSK {
        return Err(AppError::invalid_input(
            "Focus-loss reporting is only active in kiosk mode.",
        ));
    }

    let et = req.event_type.trim();
    if et.is_empty() || et.len() > 64 {
        return Err(AppError::invalid_input("eventType is invalid."));
    }

    quiz_attempts::insert_focus_loss_event(&state.pool, att.id, et, req.duration_ms).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn quiz_attempt_focus_loss_events_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, attempt_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<QuizFocusLossEventsResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let required = course_grants::course_item_create_permission(&course_code);
    let can_edit = rbac::user_has_permission(&state.pool, user.user_id, &required).await?;
    if !can_edit {
        return Err(AppError::Forbidden);
    }

    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    let mode = quiz_lockdown::effective_lockdown_mode(course_row.lockdown_mode_enabled, &quiz_row);
    if mode != quiz_lockdown::LOCKDOWN_KIOSK {
        return Err(AppError::Forbidden);
    }

    let Some(att) = quiz_attempts::get_attempt(&state.pool, attempt_id).await? else {
        return Err(AppError::NotFound);
    };
    if att.course_id != course_id || att.structure_item_id != item_id {
        return Err(AppError::NotFound);
    }

    let rows = quiz_attempts::list_focus_loss_events(&state.pool, attempt_id).await?;
    let total = quiz_attempts::count_focus_loss_events(&state.pool, attempt_id).await?;
    let events = rows
        .into_iter()
        .map(|r| QuizFocusLossEventApi {
            id: r.id,
            event_type: r.event_type,
            duration_ms: r.duration_ms,
            created_at: r.created_at,
        })
        .collect();
    Ok(Json(QuizFocusLossEventsResponse { events, total }))
}

async fn quiz_attempt_hint_stub_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, attempt_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(_req): Json<QuizAttemptHintRequest>,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let course_id = course_row.id;

    let Some(quiz_row) =
        course_module_quizzes::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    let Some(att) = quiz_attempts::get_attempt(&state.pool, attempt_id).await? else {
        return Err(AppError::NotFound);
    };
    if att.student_user_id != user.user_id
        || att.course_id != course_id
        || att.structure_item_id != item_id
        || att.status != "in_progress"
    {
        return Err(AppError::Forbidden);
    }

    accommodations::require_attempt_within_deadline(&att, Utc::now())?;

    let mode = quiz_lockdown::effective_lockdown_mode(course_row.lockdown_mode_enabled, &quiz_row);
    let acc = accommodations::resolve_effective_or_default(&state.pool, user.user_id, course_id).await;
    if quiz_lockdown::hints_disabled(mode) && !acc.hints_always_enabled {
        return Err(AppError::Forbidden);
    }
    Err(AppError::invalid_input(
        "Hints are not implemented for this quiz yet.",
    ))
}

fn structure_path_rule_row_to_api(
    r: crate::repos::adaptive_path::StructurePathRuleRow,
) -> StructurePathRuleResponse {
    StructurePathRuleResponse {
        id: r.id,
        structure_item_id: r.structure_item_id,
        rule_type: r.rule_type,
        concept_ids: r.concept_ids,
        threshold: r.threshold,
        target_item_id: r.target_item_id,
        priority: r.priority,
        created_at: r.created_at,
    }
}

async fn course_concepts_for_path_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Vec<ConceptJson>>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let rows = concepts::list_concepts_for_course(&state.pool, course_id)
        .await
        .map_err(AppError::Db)?;
    Ok(Json(rows.into_iter().map(ConceptJson::from).collect()))
}

async fn path_rules_list_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<Vec<StructurePathRuleResponse>>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    if course_structure::get_item_row(&state.pool, course_id, item_id)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound);
    }
    let rows =
        adaptive_path_repo::list_rules_for_structure_item(&state.pool, course_id, item_id).await?;
    Ok(Json(
        rows
            .into_iter()
            .map(structure_path_rule_row_to_api)
            .collect(),
    ))
}

async fn path_rules_post_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(req): Json<CreateStructurePathRuleRequest>,
) -> Result<Json<StructurePathRuleResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    if course_structure::get_item_row(&state.pool, course_id, item_id)
        .await?
        .is_none()
    {
        return Err(AppError::NotFound);
    }

    if !(0.0..=1.0).contains(&req.threshold) {
        return Err(AppError::invalid_input("threshold must be between 0 and 1."));
    }
    adaptive_path_service::validate_rule_type(&req.rule_type)?;
    if req.concept_ids.is_empty() {
        return Err(AppError::invalid_input("conceptIds must be non-empty."));
    }
    match req.rule_type.as_str() {
        "required_if_not_mastered" | "unlock_after" | "remediation_insert" => {
            if req.target_item_id.is_none() {
                return Err(AppError::invalid_input(
                    "targetItemId is required for this rule type.",
                ));
            }
        }
        _ => {}
    }

    adaptive_path_service::validate_concepts_for_course(&state.pool, course_id, &req.concept_ids)
        .await?;
    adaptive_path_service::validate_rule_targets_in_course(
        &state.pool,
        course_id,
        item_id,
        req.target_item_id,
    )
    .await?;

    let row = adaptive_path_repo::insert_rule(
        &state.pool,
        item_id,
        &req.rule_type,
        &req.concept_ids,
        req.threshold,
        req.target_item_id,
        req.priority.unwrap_or(0),
    )
    .await
    .map_err(AppError::Db)?;
    Ok(Json(structure_path_rule_row_to_api(row)))
}

async fn path_rules_delete_handler(
    State(state): State<AppState>,
    Path((course_code, _item_id, rule_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;
    let Some(course_id) = course::get_id_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };
    let ok = adaptive_path_repo::delete_rule_for_course(&state.pool, course_id, rule_id)
        .await
        .map_err(AppError::Db)?;
    if !ok {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn adaptive_path_preview_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: HeaderMap,
    Query(q): Query<AdaptivePathPreviewQuery>,
) -> Result<Json<AdaptivePathPreviewResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    require_course_access(&state, &course_code, user.user_id).await?;
    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let raw: HashMap<String, serde_json::Value> = serde_json::from_str(q.mastery.trim()).map_err(|_| {
        AppError::invalid_input(
            "Query parameter \"mastery\" must be a JSON object mapping concept id strings to scores.",
        )
    })?;
    let mut mastery: HashMap<Uuid, f64> = HashMap::with_capacity(raw.len());
    for (k, v) in raw {
        let id = Uuid::parse_str(k.trim()).map_err(|_| {
            AppError::invalid_input("mastery keys must be UUID strings (concept ids).")
        })?;
        let score = v
            .as_f64()
            .ok_or_else(|| AppError::invalid_input("mastery values must be numbers 0–1."))?
            .clamp(0.0, 1.0);
        mastery.insert(id, score);
    }

    let global_on = adaptive_path_service::adaptive_paths_globally_enabled();
    let adaptive_on = adaptive_path_service::adaptive_paths_active_for_course(
        global_on,
        course_row.adaptive_paths_enabled,
    );

    let mut rows = course_structure::list_for_course(&state.pool, course_row.id).await?;
    rows = course_structure::filter_archived_items_from_structure_list(rows);
    let rules = adaptive_path_repo::list_rules_for_course(&state.pool, course_row.id).await?;

    let (path, fallback) =
        adaptive_path_service::preview_path_item_ids(&rows, &mastery, &rules, adaptive_on, 512);
    Ok(Json(AdaptivePathPreviewResponse { path, fallback }))
}

#[cfg(test)]
mod parse_email_list_tests {
    use crate::services::enrollments::parse_email_list;

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
