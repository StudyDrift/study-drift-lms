use axum::{
    extract::{Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::repos::course;
use crate::repos::course_grants;
use crate::repos::enrollment;
use crate::repos::qti_import as import_repo;
use crate::services::qti_import;
use crate::services::zip_import;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/imports/qti", post(start_qti_import_handler))
        .route(
            "/api/v1/imports/{job_id}/status",
            get(import_status_handler),
        )
        .route("/api/v1/imports", get(list_imports_handler))
}

async fn require_question_bank_authoring(
    state: &AppState,
    course_code: &str,
    user_id: Uuid,
) -> Result<(), AppError> {
    let required = course_grants::course_items_create_permission(course_code);
    assert_permission(&state.pool, user_id, &required).await
}

fn detect_import_type(filename: &str) -> &'static str {
    let f = filename.to_ascii_lowercase();
    if f.ends_with(".imscc") {
        "common_cartridge"
    } else {
        "qti21"
    }
}

async fn start_qti_import_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let user = auth_user(&state, &headers)?;
    let mut course_id: Option<Uuid> = None;
    let mut file_name: Option<String> = None;
    let mut file_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::invalid_input(format!("multipart error: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "course_id" {
            let s = field
                .text()
                .await
                .map_err(|e| AppError::invalid_input(format!("course_id: {e}")))?;
            course_id = Some(
                Uuid::parse_str(s.trim())
                    .map_err(|_| AppError::invalid_input("course_id must be a UUID."))?,
            );
        } else if name == "file" {
            file_name = field.file_name().map(|s| s.to_string());
            let bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::invalid_input(format!("file: {e}")))?;
            file_bytes = Some(bytes.to_vec());
        }
    }

    let Some(course_id) = course_id else {
        return Err(AppError::invalid_input("course_id is required."));
    };
    let Some(bytes) = file_bytes else {
        return Err(AppError::invalid_input("file is required."));
    };
    if bytes.is_empty() {
        return Err(AppError::invalid_input("file is empty."));
    }

    if let Err(e) = zip_import::validate_zip_limits(&bytes) {
        return Err(AppError::UnprocessableEntity {
            message: zip_import::user_visible_message(&e),
        });
    }

    let Some(course) = course::get_by_id(&state.pool, course_id).await? else {
        return Err(AppError::NotFound);
    };

    let ok = enrollment::user_has_access(&state.pool, &course.course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }
    require_question_bank_authoring(&state, &course.course_code, user.user_id).await?;

    let flags = import_repo::course_import_flags(&state.pool, course_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let (question_bank_enabled, qti_import_enabled) = flags;
    if !question_bank_enabled {
        return Err(AppError::invalid_input(
            "Question bank is not enabled for this course.",
        ));
    }
    if !qti_import_enabled {
        return Err(AppError::invalid_input(
            "QTI import is not enabled for this course.",
        ));
    }

    let original_filename = file_name.unwrap_or_else(|| "upload.zip".into());
    let import_type = detect_import_type(&original_filename).to_string();

    let job_id = import_repo::insert_import_job(
        &state.pool,
        course_id,
        &import_type,
        &original_filename,
        user.user_id,
    )
    .await?;

    let pool = state.pool.clone();
    let actor_id = user.user_id;
    tokio::spawn(async move {
        qti_import::run_import_job(
            pool,
            job_id,
            course_id,
            actor_id,
            import_type,
            original_filename,
            bytes,
        )
        .await;
    });

    Ok((StatusCode::ACCEPTED, Json(json!({ "jobId": job_id }))))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListImportsQuery {
    #[serde(default)]
    course_id: Option<Uuid>,
    #[serde(default)]
    limit: Option<i64>,
}

async fn import_status_handler(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    let row = import_repo::get_import_job(&state.pool, job_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.created_by != user.user_id {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!({
        "status": row.status,
        "totalItems": row.total_items,
        "processedItems": row.processed_items,
        "succeededItems": row.succeeded_items,
        "failedItems": row.failed_items,
        "skippedItems": row.skipped_items,
        "errorLog": row.error_log,
        "completedAt": row.completed_at,
    })))
}

async fn list_imports_handler(
    State(state): State<AppState>,
    Query(q): Query<ListImportsQuery>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = auth_user(&state, &headers)?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let rows =
        import_repo::list_import_jobs_for_user(&state.pool, user.user_id, q.course_id, limit)
            .await?;
    let imports: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "courseId": r.course_id,
                "importType": r.import_type,
                "originalFilename": r.original_filename,
                "status": r.status,
                "totalItems": r.total_items,
                "processedItems": r.processed_items,
                "succeededItems": r.succeeded_items,
                "failedItems": r.failed_items,
                "skippedItems": r.skipped_items,
                "createdAt": r.created_at,
                "completedAt": r.completed_at,
            })
        })
        .collect();
    Ok(Json(json!({ "imports": imports })))
}
