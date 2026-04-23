use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::{get, patch, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use crate::error::{AppError, ErrorCode};
use crate::http_auth::auth_user;
use crate::repos::course;
use crate::repos::course_files;
use crate::repos::course_module_assignments;
use crate::repos::course_structure;
use crate::repos::enrollment;
use crate::repos::grade_audit_events;
use crate::repos::module_assignment_submissions::{self, GradedFilter, SubmissionRow};
use crate::repos::submission_annotations::{self, AnnotationRow, AnnotationUpsertWrite};
use crate::repos::submission_versions;
use crate::services::course_image_upload::{
    course_file_content_path, ingest_multipart_submission_document_field,
    persist_course_submission_attachment,
};
use crate::services::grading::resubmission;
use crate::services::originality::spawn_originality_detection_job;
use crate::routes::blind_grading_redaction;
use crate::services::submission_annotated_pdf;
use crate::state::AppState;

const ANNOTATION_WRITES_PER_MINUTE: usize = 60;

static ANNOTATION_WRITE_RL: OnceLock<Mutex<HashMap<Uuid, Vec<Instant>>>> = OnceLock::new();

fn annotation_rl_map() -> &'static Mutex<HashMap<Uuid, Vec<Instant>>> {
    ANNOTATION_WRITE_RL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn check_annotation_write_rate_limit(user_id: Uuid) -> Result<(), AppError> {
    let mut map = annotation_rl_map()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    let window = Duration::from_secs(60);
    let v = map.entry(user_id).or_default();
    v.retain(|t| now.duration_since(*t) < window);
    if v.len() >= ANNOTATION_WRITES_PER_MINUTE {
        return Err(AppError::TooManyRequests(
            "Too many annotation writes; try again in a minute.".into(),
        ));
    }
    v.push(now);
    Ok(())
}

fn require_annotation_feature(state: &AppState) -> Result<(), AppError> {
    if !state.annotation_enabled {
        return Err(AppError::NotFound);
    }
    Ok(())
}

async fn resolve_course_id(state: &AppState, course_code: &str) -> Result<Uuid, AppError> {
    let Some(row) = course::get_by_course_code(&state.pool, course_code).await? else {
        return Err(AppError::NotFound);
    };
    Ok(row.id)
}

fn can_view_submission(user_id: Uuid, staff: bool, row: &SubmissionRow) -> bool {
    staff || row.submitted_by == user_id
}

fn can_write_annotations(staff: bool) -> bool {
    staff
}

/// When blind grading is active for staff, maps each submission id to its stable rank (1-based).
async fn assignment_staff_blind_rank_map(
    pool: &sqlx::PgPool,
    course_id: Uuid,
    item_id: Uuid,
    staff: bool,
    feature_enabled: bool,
) -> Result<(bool, HashMap<Uuid, usize>), AppError> {
    let Some(asn) =
        course_module_assignments::get_for_course_item(pool, course_id, item_id).await?
    else {
        return Ok((false, HashMap::new()));
    };
    let redact = blind_grading_redaction::should_redact_submission_pii_for_staff(
        feature_enabled,
        asn.blind_grading,
        asn.identities_revealed_at.is_some(),
    ) && staff;
    let ranks = if redact {
        let all = module_assignment_submissions::list_for_assignment(
            pool,
            course_id,
            item_id,
            GradedFilter::All,
        )
        .await?;
        blind_grading_redaction::submission_rank_by_id(&all)
    } else {
        HashMap::new()
    };
    Ok((redact, ranks))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/reveal-identities",
            post(reveal_identities_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions",
            get(list_submissions_handler).post(post_submission_json_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/upload",
            post(post_submission_upload_handler).layer(DefaultBodyLimit::max(25 * 1024 * 1024)),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/mine",
            get(get_my_submission_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}",
            get(get_submission_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/request-revision",
            post(request_revision_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/versions",
            get(list_submission_versions_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/annotations",
            get(list_annotations_handler).post(post_annotation_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/annotations/{annotation_id}",
            patch(patch_annotation_handler).delete(delete_annotation_handler),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/annotated-pdf",
            get(download_annotated_pdf_handler),
        )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionsListQuery {
    #[serde(default = "default_filter")]
    graded: String,
}

fn default_filter() -> String {
    "all".into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevealIdentitiesBody {
    #[serde(default)]
    force: bool,
}

async fn reveal_identities_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<RevealIdentitiesBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !state.blind_grading_enabled {
        return Err(AppError::NotFound);
    }
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    if !enrollment::user_is_course_creator(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(asn) =
        course_module_assignments::get_for_course_item(&state.pool, course_id, item_id).await?
    else {
        return Err(AppError::NotFound);
    };
    if !asn.blind_grading {
        return Err(AppError::invalid_input(
            "Blind grading is not enabled for this assignment.",
        ));
    }
    if let Some(prev) = asn.identities_revealed_at {
        return Ok(Json(json!({
            "ok": true,
            "identitiesRevealedAt": prev,
            "alreadyRevealed": true
        })));
    }

    let ungraded =
        module_assignment_submissions::count_ungraded_for_assignment(&state.pool, course_id, item_id)
            .await?;
    if ungraded > 0 && !body.force {
        return Err(AppError::invalid_input(format!(
            "{ungraded} submission(s) are still ungraded. Resubmit with {{ \"force\": true }} after confirming."
        )));
    }

    let Some(at) = course_module_assignments::reveal_blind_grading_identities(
        &state.pool,
        course_id,
        item_id,
        user.user_id,
    )
    .await?
    else {
        return Err(AppError::invalid_input(
            "Could not reveal identities (assignment may have changed).",
        ));
    };

    tracing::info!(
        target: "lextures.audit",
        event = "blind_grading_revealed",
        course_code = %course_code,
        item_id = %item_id,
        instructor_id = %user.user_id,
        "blind grading identities revealed"
    );

    Ok(Json(
        json!({ "ok": true, "identitiesRevealedAt": at, "alreadyRevealed": false }),
    ))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionResponse {
    id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    submitted_by: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    blind_label: Option<String>,
    attachment_file_id: Option<Uuid>,
    submitted_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachment_content_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attachment_mime_type: Option<String>,
    /// Per-student revision state (plan 3.13).
    resubmission_requested: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision_due_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision_feedback: Option<String>,
    version_number: i32,
}

fn submission_to_response(
    course_code: &str,
    row: &SubmissionRow,
    file: Option<&crate::repos::course_files::CourseFileRow>,
    redact_student_pii: bool,
    blind_rank: Option<usize>,
) -> SubmissionResponse {
    let blind_label = if redact_student_pii {
        blind_rank.map(blind_grading_redaction::blind_student_label)
    } else {
        None
    };
    let submitted_by = if redact_student_pii {
        None
    } else {
        Some(row.submitted_by)
    };
    SubmissionResponse {
        id: row.id,
        submitted_by,
        blind_label,
        attachment_file_id: row.attachment_file_id,
        submitted_at: row.submitted_at,
        updated_at: row.updated_at,
        attachment_content_path: row
            .attachment_file_id
            .map(|fid| course_file_content_path(course_code, fid)),
        attachment_mime_type: file.map(|f| f.mime_type.clone()),
        resubmission_requested: row.resubmission_requested,
        revision_due_at: row.revision_due_at,
        revision_feedback: row.revision_feedback.clone(),
        version_number: row.version_number,
    }
}

/// Persists a new or replacement file, enforcing plan 3.13 when enabled.
async fn persist_submission_file(
    state: &AppState,
    course_id: Uuid,
    item_id: Uuid,
    submitted_by: Uuid,
    actor_user_id: Uuid,
    new_file_id: Uuid,
) -> Result<SubmissionRow, AppError> {
    let now = Utc::now();
    let existing = module_assignment_submissions::get_for_course_item_user(
        &state.pool,
        course_id,
        item_id,
        submitted_by,
    )
    .await?;
    if !state.resubmission_workflow_enabled {
        return Ok(
            module_assignment_submissions::upsert_attachment(
                &state.pool,
                course_id,
                item_id,
                submitted_by,
                new_file_id,
            )
            .await?,
        );
    }
    let Some(ex) = existing else {
        return Ok(
            module_assignment_submissions::upsert_attachment(
                &state.pool,
                course_id,
                item_id,
                submitted_by,
                new_file_id,
            )
            .await?,
        );
    };
    resubmission::student_may_resubmit(now, &ex)?;
    let mut tx = state.pool.begin().await?;
    let opt = module_assignment_submissions::resubmit_versioned_in_transaction(
        &mut tx, now, course_id, ex.id, new_file_id,
    )
    .await?;
    let Some(row) = opt else {
        return Err(AppError::UnprocessableEntity {
            message: "Could not resubmit. Check that a revision is still open.".into(),
        });
    };
    grade_audit_events::insert(
        &mut *tx,
        course_id,
        item_id,
        submitted_by,
        Some(actor_user_id),
        "resubmission_received",
        None,
        None,
        None,
        None,
        Some("Student resubmitted a new file version."),
    )
    .await?;
    tx.commit().await?;
    tracing::info!(
        target: "lextures.audit",
        event = "resubmission_received",
        course_id = %course_id,
        assignment_id = %item_id,
        student_id = %submitted_by,
        "resubmission stored"
    );
    Ok(row)
}

async fn list_submissions_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    Query(q): Query<SubmissionsListQuery>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    if !staff {
        return Err(AppError::Forbidden);
    }

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(item) = course_structure::get_item_row(&state.pool, course_id, item_id).await? else {
        return Err(AppError::NotFound);
    };
    if item.kind != "assignment" {
        return Err(AppError::NotFound);
    }

    let (redact, rank_map) = assignment_staff_blind_rank_map(
        &state.pool,
        course_id,
        item_id,
        staff,
        state.blind_grading_enabled,
    )
    .await?;

    let filter = match q.graded.as_str() {
        "graded" => GradedFilter::Graded,
        "ungraded" => GradedFilter::Ungraded,
        _ => GradedFilter::All,
    };
    let rows =
        module_assignment_submissions::list_for_assignment(&state.pool, course_id, item_id, filter)
            .await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let file = if let Some(fid) = r.attachment_file_id {
            course_files::get_for_course(&state.pool, &course_code, fid).await?
        } else {
            None
        };
        let rank = rank_map.get(&r.id).copied();
        out.push(submission_to_response(
            &course_code,
            r,
            file.as_ref(),
            redact,
            rank,
        ));
    }

    tracing::info!(
        target: "lextures.audit",
        event = "submission.opened_for_grading",
        course_code = %course_code,
        item_id = %item_id,
        viewer_id = %user.user_id,
        count = out.len(),
        "listed assignment submissions"
    );

    Ok(Json(json!({ "submissions": out })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostSubmissionJson {
    course_file_id: Uuid,
    #[serde(default)]
    student_user_id: Option<Uuid>,
}

async fn post_submission_json_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<PostSubmissionJson>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(item) = course_structure::get_item_row(&state.pool, course_id, item_id).await? else {
        return Err(AppError::NotFound);
    };
    if item.kind != "assignment" {
        return Err(AppError::NotFound);
    }

    let asn = course_module_assignments::get_for_course_item(&state.pool, course_id, item_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !asn.submission_allow_file_upload {
        return Err(AppError::invalid_input(
            "This assignment does not accept file uploads.",
        ));
    }

    let Some(file_row) =
        course_files::get_for_course(&state.pool, &course_code, body.course_file_id).await?
    else {
        return Err(AppError::NotFound);
    };

    let submitted_by = if let Some(sid) = body.student_user_id {
        if !staff {
            return Err(AppError::Forbidden);
        }
        sid
    } else {
        user.user_id
    };

    if submitted_by != user.user_id {
        let is_student = enrollment::user_has_enrollment_role(
            &state.pool,
            &course_code,
            submitted_by,
            "student",
        )
        .await?;
        if !is_student {
            return Err(AppError::invalid_input(
                "studentUserId must refer to a student enrolled in this course.",
            ));
        }
    }

    let row = persist_submission_file(
        &state,
        course_id,
        item_id,
        submitted_by,
        user.user_id,
        file_row.id,
    )
    .await?;

    spawn_originality_detection_job(state.clone(), course_code.clone(), row.id);

    let redact = state.blind_grading_enabled
        && staff
        && blind_grading_redaction::should_redact_submission_pii_for_staff(
            state.blind_grading_enabled,
            asn.blind_grading,
            asn.identities_revealed_at.is_some(),
        );
    let rank = if redact {
        let all = module_assignment_submissions::list_for_assignment(
            &state.pool,
            course_id,
            item_id,
            GradedFilter::All,
        )
        .await?;
        blind_grading_redaction::submission_rank_by_id(&all)
            .get(&row.id)
            .copied()
    } else {
        None
    };
    let resp = submission_to_response(&course_code, &row, Some(&file_row), redact, rank);
    Ok(Json(json!({ "submission": resp })))
}

async fn post_submission_upload_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(item) = course_structure::get_item_row(&state.pool, course_id, item_id).await? else {
        return Err(AppError::NotFound);
    };
    if item.kind != "assignment" {
        return Err(AppError::NotFound);
    }

    let asn = course_module_assignments::get_for_course_item(&state.pool, course_id, item_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !asn.submission_allow_file_upload {
        return Err(AppError::invalid_input(
            "This assignment does not accept file uploads.",
        ));
    }

    let (bytes, original_filename, mime_type) =
        ingest_multipart_submission_document_field(&mut multipart).await?;

    let upload = persist_course_submission_attachment(
        &state.pool,
        &state.course_files_root,
        course_id,
        &course_code,
        user.user_id,
        bytes,
        original_filename,
        mime_type,
    )
    .await?;

    let row = persist_submission_file(
        &state,
        course_id,
        item_id,
        user.user_id,
        user.user_id,
        upload.id,
    )
    .await?;

    spawn_originality_detection_job(state.clone(), course_code.clone(), row.id);

    let file_row = course_files::get_for_course(&state.pool, &course_code, upload.id)
        .await?
        .ok_or(AppError::NotFound)?;

    let resp = submission_to_response(&course_code, &row, Some(&file_row), false, None);
    Ok(Json(json!({ "submission": resp, "upload": upload })))
}

async fn get_my_submission_handler(
    State(state): State<AppState>,
    Path((course_code, item_id)): Path<(String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(item) = course_structure::get_item_row(&state.pool, course_id, item_id).await? else {
        return Err(AppError::NotFound);
    };
    if item.kind != "assignment" {
        return Err(AppError::NotFound);
    }

    let row = module_assignment_submissions::get_for_course_item_user(
        &state.pool,
        course_id,
        item_id,
        user.user_id,
    )
    .await?;
    let Some(r) = row else {
        return Ok(Json(json!({ "submission": serde_json::Value::Null })));
    };
    let file = if let Some(fid) = r.attachment_file_id {
        course_files::get_for_course(&state.pool, &course_code, fid).await?
    } else {
        None
    };
    let resp = submission_to_response(&course_code, &r, file.as_ref(), false, None);
    Ok(Json(json!({ "submission": resp })))
}

async fn get_submission_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(row) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if row.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    if !can_view_submission(user.user_id, staff, &row) {
        return Err(AppError::Forbidden);
    }

    let (redact, rank_map) = assignment_staff_blind_rank_map(
        &state.pool,
        course_id,
        item_id,
        staff,
        state.blind_grading_enabled,
    )
    .await?;
    let rank = rank_map.get(&row.id).copied();

    let file = if let Some(fid) = row.attachment_file_id {
        course_files::get_for_course(&state.pool, &course_code, fid).await?
    } else {
        None
    };
    let resp = submission_to_response(&course_code, &row, file.as_ref(), redact, rank);
    Ok(Json(json!({ "submission": resp })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestRevisionBody {
    #[serde(default)]
    revision_due_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    revision_feedback: Option<String>,
}

async fn request_revision_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<RequestRevisionBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    if !state.resubmission_workflow_enabled {
        return Err(AppError::NotFound);
    }
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    if !enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await? {
        return Err(AppError::Forbidden);
    }
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(row) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if row.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    let feedback = body
        .revision_feedback
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    resubmission::request_revision(
        &state,
        &state.pool,
        course_id,
        &course_code,
        item_id,
        user.user_id,
        row.submitted_by,
        &row,
        body.revision_due_at,
        feedback,
    )
    .await?;
    let row2 = module_assignment_submissions::get_by_id(&state.pool, submission_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let file = if let Some(fid) = row2.attachment_file_id {
        course_files::get_for_course(&state.pool, &course_code, fid).await?
    } else {
        None
    };
    let resp = submission_to_response(&course_code, &row2, file.as_ref(), false, None);
    Ok(Json(json!({ "ok": true, "submission": resp })))
}

async fn list_submission_versions_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    if !state.resubmission_workflow_enabled {
        return Err(AppError::NotFound);
    }
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(row) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if row.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    if !can_view_submission(user.user_id, staff, &row) {
        return Err(AppError::Forbidden);
    }
    let archived = submission_versions::list_for_student_item(
        &state.pool,
        course_id,
        item_id,
        row.submitted_by,
    )
    .await?;
    let mut versions: Vec<serde_json::Value> = Vec::new();
    for av in archived {
        let file = if let Some(fid) = av.attachment_file_id {
            course_files::get_for_course(&state.pool, &course_code, fid).await?
        } else {
            None
        };
        versions.push(resubmission::version_json(
            av.version_number,
            av.submitted_at,
            av.attachment_file_id,
            file.map(|f| f.mime_type.clone()),
            &course_code,
        ));
    }
    let file = if let Some(fid) = row.attachment_file_id {
        course_files::get_for_course(&state.pool, &course_code, fid).await?
    } else {
        None
    };
    versions.push(resubmission::version_json(
        row.version_number,
        row.submitted_at,
        row.attachment_file_id,
        file.map(|f| f.mime_type.clone()),
        &course_code,
    ));
    versions.sort_by(|a, b| {
        let na = a
            .get("versionNumber")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let nb = b
            .get("versionNumber")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        na.cmp(&nb)
    });
    Ok(Json(json!({ "versions": versions })))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnotationResponse {
    id: Uuid,
    submission_id: Uuid,
    annotator_id: Uuid,
    client_id: String,
    page: i32,
    tool_type: String,
    colour: String,
    coords_json: serde_json::Value,
    body: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

fn ann_row(a: &AnnotationRow) -> AnnotationResponse {
    AnnotationResponse {
        id: a.id,
        submission_id: a.submission_id,
        annotator_id: a.annotator_id,
        client_id: a.client_id.clone(),
        page: a.page,
        tool_type: a.tool_type.clone(),
        colour: a.colour.clone(),
        coords_json: a.coords_json.clone(),
        body: a.body.clone(),
        created_at: a.created_at,
        updated_at: a.updated_at,
    }
}

async fn list_annotations_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(row) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if row.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    if !can_view_submission(user.user_id, staff, &row) {
        return Err(AppError::Forbidden);
    }

    let list =
        submission_annotations::list_active_for_submission(&state.pool, submission_id).await?;
    let mapped: Vec<_> = list.iter().map(ann_row).collect();
    Ok(Json(json!({ "annotations": mapped })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostAnnotationBody {
    client_id: String,
    page: i32,
    tool_type: String,
    colour: String,
    coords_json: serde_json::Value,
    body: Option<String>,
}

async fn post_annotation_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<PostAnnotationBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    if !can_write_annotations(staff) {
        return Err(AppError::Forbidden);
    }

    check_annotation_write_rate_limit(user.user_id)?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(row) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if row.module_item_id != item_id {
        return Err(AppError::NotFound);
    }

    let tool = body.tool_type.as_str();
    if !matches!(tool, "highlight" | "draw" | "text" | "pin") {
        return Err(AppError::InvalidInput {
            code: ErrorCode::InvalidInput,
            message: "toolType must be highlight, draw, text, or pin.".into(),
        });
    }
    if body.page < 1 {
        return Err(AppError::invalid_input("page must be >= 1"));
    }
    let cid = body.client_id.trim();
    if cid.is_empty() {
        return Err(AppError::invalid_input("clientId is required"));
    }

    let saved = submission_annotations::upsert(
        &state.pool,
        AnnotationUpsertWrite {
            submission_id,
            annotator_id: user.user_id,
            client_id: cid,
            page: body.page,
            tool_type: tool,
            colour: body.colour.trim(),
            coords_json: body.coords_json,
            body: body.body.as_deref(),
        },
    )
    .await?;

    tracing::info!(
        target: "lextures.audit",
        event = "annotation.created",
        submission_id = %submission_id,
        annotation_id = %saved.id,
        annotator_id = %user.user_id,
        tool_type = %saved.tool_type,
        "annotation upserted"
    );

    Ok(Json(json!({ "annotation": ann_row(&saved) })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatchAnnotationBody {
    body: Option<String>,
}

async fn patch_annotation_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id, annotation_id)): Path<(String, Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<PatchAnnotationBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }

    check_annotation_write_rate_limit(user.user_id)?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(sub) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if sub.module_item_id != item_id {
        return Err(AppError::NotFound);
    }

    let Some(cur) = submission_annotations::get_by_id(&state.pool, annotation_id).await? else {
        return Err(AppError::NotFound);
    };
    if cur.submission_id != submission_id {
        return Err(AppError::NotFound);
    }
    if cur.annotator_id != user.user_id {
        return Err(AppError::Forbidden);
    }

    let updated = submission_annotations::patch_body(
        &state.pool,
        annotation_id,
        user.user_id,
        body.body.as_deref(),
    )
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(json!({ "annotation": ann_row(&updated) })))
}

async fn delete_annotation_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id, annotation_id)): Path<(String, Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;

    check_annotation_write_rate_limit(user.user_id)?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(sub) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if sub.module_item_id != item_id {
        return Err(AppError::NotFound);
    }

    let Some(cur) = submission_annotations::get_by_id(&state.pool, annotation_id).await? else {
        return Err(AppError::NotFound);
    };
    if cur.submission_id != submission_id {
        return Err(AppError::NotFound);
    }
    if cur.annotator_id != user.user_id && !staff {
        return Err(AppError::Forbidden);
    }

    let ok_del = submission_annotations::soft_delete(&state.pool, annotation_id).await?;
    if !ok_del {
        return Err(AppError::NotFound);
    }

    tracing::info!(
        target: "lextures.audit",
        event = "annotation.deleted",
        submission_id = %submission_id,
        annotation_id = %annotation_id,
        actor_id = %user.user_id,
        "annotation soft-deleted"
    );

    Ok(StatusCode::NO_CONTENT)
}

async fn download_annotated_pdf_handler(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    require_annotation_feature(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;

    let course_id = resolve_course_id(&state, &course_code).await?;
    let Some(sub) =
        module_assignment_submissions::get_by_id_for_course(&state.pool, course_id, submission_id)
            .await?
    else {
        return Err(AppError::NotFound);
    };
    if sub.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    if !can_view_submission(user.user_id, staff, &sub) {
        return Err(AppError::Forbidden);
    }

    let Some(fid) = sub.attachment_file_id else {
        return Err(AppError::invalid_input(
            "Submission has no attachment file.",
        ));
    };
    let Some(file_row) = course_files::get_for_course(&state.pool, &course_code, fid).await? else {
        return Err(AppError::NotFound);
    };
    if file_row.mime_type != "application/pdf" {
        return Err(AppError::invalid_input(
            "Annotated PDF export is only available for PDF submissions today.",
        ));
    }

    let path = course_files::blob_disk_path(
        &state.course_files_root,
        &course_code,
        &file_row.storage_key,
    );
    let pdf_bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| AppError::NotFound)?;

    let annotations =
        submission_annotations::list_active_for_submission(&state.pool, submission_id).await?;
    let merged = submission_annotated_pdf::merge_annotations_into_pdf(&pdf_bytes, &annotations);

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(
            header::CONTENT_DISPOSITION,
            r#"attachment; filename="annotated-submission.pdf""#,
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header("X-Lextures-Annotation-Flatten", "overlay-v1")
        .body(Body::from(merged))
        .map_err(|e| AppError::invalid_input(e.to_string()))
}
