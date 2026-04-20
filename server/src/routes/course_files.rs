use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{header, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::{assert_permission, auth_user};
use crate::models::course_file::CourseFileUploadResponse;
use crate::repos::course;
use crate::repos::course_files;
use crate::repos::course_grants;
use crate::repos::enrollment;
use crate::services::course_image_upload;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/course-files",
            post(upload_course_file_handler).layer(DefaultBodyLimit::max(25 * 1024 * 1024)),
        )
        .route(
            "/api/v1/courses/{course_code}/course-files/{file_id}/content",
            get(download_course_file_handler),
        )
}

async fn upload_course_file_handler(
    State(state): State<AppState>,
    Path(course_code): Path<String>,
    headers: axum::http::HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<CourseFileUploadResponse>, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }

    let required = course_grants::course_item_create_permission(&course_code);
    assert_permission(&state.pool, user.user_id, &required).await?;

    let Some(course_row) = course::get_by_course_code(&state.pool, &course_code).await? else {
        return Err(AppError::NotFound);
    };

    let (bytes, original_filename, mime_type) =
        course_image_upload::ingest_multipart_image_field(&mut multipart).await?;

    let resp = course_image_upload::persist_course_image(
        &state.pool,
        &state.course_files_root,
        course_row.id,
        &course_code,
        user.user_id,
        bytes,
        original_filename,
        mime_type,
    )
    .await?;

    Ok(Json(resp))
}

async fn download_course_file_handler(
    State(state): State<AppState>,
    Path((course_code, file_id)): Path<(String, Uuid)>,
    headers: axum::http::HeaderMap,
) -> Result<Response, AppError> {
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::NotFound);
    }

    let Some(row) = course_files::get_for_course(&state.pool, &course_code, file_id).await? else {
        return Err(AppError::NotFound);
    };

    let path = course_files::blob_disk_path(&state.course_files_root, &course_code, &row.storage_key);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| AppError::NotFound)?;

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, row.mime_type.as_str())
        .header(header::CACHE_CONTROL, "private, max-age=86400")
        .body(Body::from(bytes))
        .map_err(|e| AppError::invalid_input(e.to_string()))?)
}
