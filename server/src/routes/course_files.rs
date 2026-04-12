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
use crate::state::AppState;

const MAX_COURSE_FILE_BYTES: usize = 20 * 1024 * 1024;

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

fn normalize_image_mime(raw: Option<&str>) -> Option<&'static str> {
    let t = raw?.split(';').next()?.trim().to_ascii_lowercase();
    match t.as_str() {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        _ => None,
    }
}

fn ext_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "bin",
    }
}

fn truncate_filename(name: &str) -> String {
    let t = name.trim();
    if t.is_empty() {
        return "upload".into();
    }
    t.chars().take(240).collect()
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

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut original_name: Option<String> = None;
    let mut mime: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::InvalidInput(format!("multipart read failed: {e}")))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let fname = field
            .file_name()
            .map(truncate_filename)
            .unwrap_or_else(|| "upload".into());
        let ct = field.content_type().map(|s| s.to_string());
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::InvalidInput(format!("could not read file field: {e}")))?;
        if bytes.len() > MAX_COURSE_FILE_BYTES {
            return Err(AppError::InvalidInput(format!(
                "Image is too large (max {} MB).",
                MAX_COURSE_FILE_BYTES / (1024 * 1024)
            )));
        }
        let Some(m) = normalize_image_mime(ct.as_deref()) else {
            return Err(AppError::InvalidInput(
                "Only PNG, JPEG, GIF, and WebP images are allowed.".into(),
            ));
        };
        file_bytes = Some(bytes.to_vec());
        original_name = Some(fname);
        mime = Some(m.to_string());
        break;
    }

    let Some(bytes) = file_bytes else {
        return Err(AppError::InvalidInput(
            "Missing multipart field `file`.".into(),
        ));
    };
    let original_filename = original_name.unwrap_or_else(|| "upload".into());
    let mime_type = mime.expect("set with bytes");

    let id = Uuid::new_v4();
    let ext = ext_for_mime(mime_type.as_str());
    let storage_key = format!("{id}.{ext}");
    let path = course_files::blob_disk_path(&state.course_files_root, &course_code, &storage_key);

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AppError::InvalidInput(format!("could not create storage directory: {e}"))
        })?;
    }

    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| AppError::InvalidInput(format!("could not save file: {e}")))?;

    let insert_res = course_files::insert(
        &state.pool,
        id,
        course_row.id,
        &storage_key,
        &original_filename,
        &mime_type,
        bytes.len() as i64,
        user.user_id,
    )
    .await;

    if let Err(e) = insert_res {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(e.into());
    }

    let row = insert_res.expect("checked");
    let content_path = format!(
        "/api/v1/courses/{}/course-files/{}/content",
        encode_uri_path_segment(&course_code),
        row.id
    );

    Ok(Json(CourseFileUploadResponse {
        id: row.id,
        content_path,
        mime_type: row.mime_type,
        byte_size: row.byte_size,
    }))
}

/// Encode a single path segment for use inside a path-only URL.
fn encode_uri_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(*b))
            }
            _ => {
                use std::fmt::Write;
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
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
        .map_err(|e| AppError::InvalidInput(e.to_string()))?)
}
