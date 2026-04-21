use std::fmt::Write;
use std::path::Path;

use axum::extract::Multipart;
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::models::course_file::CourseFileUploadResponse;
use crate::repos::course_files;

pub const MAX_COURSE_IMAGE_BYTES: usize = 20 * 1024 * 1024;

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

/// Encode a single path segment for use inside a path-only URL.
pub fn encode_uri_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(char::from(*b))
            }
            _ => {
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
}

pub fn course_file_content_path(course_code: &str, file_id: Uuid) -> String {
    format!(
        "/api/v1/courses/{}/course-files/{}/content",
        encode_uri_path_segment(course_code),
        file_id
    )
}

/// Reads the first multipart field named `file` as an allowed image type.
pub async fn ingest_multipart_image_field(
    multipart: &mut Multipart,
) -> Result<(Vec<u8>, String, String), AppError> {
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut original_name: Option<String> = None;
    let mut mime: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::invalid_input(format!("multipart read failed: {e}")))?
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
            .map_err(|e| AppError::invalid_input(format!("could not read file field: {e}")))?;
        if bytes.len() > MAX_COURSE_IMAGE_BYTES {
            return Err(AppError::invalid_input(format!(
                "Image is too large (max {} MB).",
                MAX_COURSE_IMAGE_BYTES / (1024 * 1024)
            )));
        }
        let Some(m) = normalize_image_mime(ct.as_deref()) else {
            return Err(AppError::invalid_input(
                "Only PNG, JPEG, GIF, and WebP images are allowed.",
            ));
        };
        file_bytes = Some(bytes.to_vec());
        original_name = Some(fname);
        mime = Some(m.to_string());
        break;
    }

    let Some(bytes) = file_bytes else {
        return Err(AppError::invalid_input(
            "Missing multipart field `file`.",
        ));
    };
    let original_filename = original_name.unwrap_or_else(|| "upload".into());
    let mime_type = match mime {
        Some(m) => m,
        None => {
            return Err(AppError::invalid_input(
                "Missing multipart field `file`.",
            ));
        }
    };
    Ok((bytes, original_filename, mime_type))
}

/// Writes bytes to disk and inserts `course.course_files` (same store as course content images).
fn normalize_submission_document_mime(raw: Option<&str>) -> Option<&'static str> {
    let t = raw?.split(';').next()?.trim().to_ascii_lowercase();
    match t.as_str() {
        "application/pdf" => Some("application/pdf"),
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/webp" => Some("image/webp"),
        _ => None,
    }
}

fn ext_for_submission_mime(mime: &str) -> &'static str {
    match mime {
        "application/pdf" => "pdf",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "bin",
    }
}

/// PDF or raster types allowed for assignment submission uploads.
pub async fn ingest_multipart_submission_document_field(
    multipart: &mut Multipart,
) -> Result<(Vec<u8>, String, String), AppError> {
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut original_name: Option<String> = None;
    let mut mime: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::invalid_input(format!("multipart read failed: {e}")))?
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
            .map_err(|e| AppError::invalid_input(format!("could not read file field: {e}")))?;
        if bytes.len() > MAX_COURSE_IMAGE_BYTES {
            return Err(AppError::invalid_input(format!(
                "File is too large (max {} MB).",
                MAX_COURSE_IMAGE_BYTES / (1024 * 1024)
            )));
        }
        let Some(m) = normalize_submission_document_mime(ct.as_deref()) else {
            return Err(AppError::invalid_input(
                "Only PDF, PNG, JPEG, and WebP files are allowed for this upload.",
            ));
        };
        file_bytes = Some(bytes.to_vec());
        original_name = Some(fname);
        mime = Some(m.to_string());
        break;
    }

    let Some(bytes) = file_bytes else {
        return Err(AppError::invalid_input(
            "Missing multipart field `file`.",
        ));
    };
    let original_filename = original_name.unwrap_or_else(|| "upload".into());
    let mime_type = mime.unwrap_or_else(|| "application/octet-stream".into());
    Ok((bytes, original_filename, mime_type))
}

/// Persists a submission document using the same on-disk layout as other `course_files` blobs.
pub async fn persist_course_submission_attachment(
    pool: &PgPool,
    course_files_root: &Path,
    course_id: Uuid,
    course_code: &str,
    user_id: Uuid,
    bytes: Vec<u8>,
    original_filename: String,
    mime_type: String,
) -> Result<CourseFileUploadResponse, AppError> {
    let id = Uuid::new_v4();
    let ext = ext_for_submission_mime(mime_type.as_str());
    let storage_key = format!("{id}.{ext}");
    let path = course_files::blob_disk_path(course_files_root, course_code, &storage_key);

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AppError::invalid_input(format!("could not create storage directory: {e}"))
        })?;
    }

    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| AppError::invalid_input(format!("could not save file: {e}")))?;

    let insert_res = course_files::insert(
        pool,
        id,
        course_id,
        &storage_key,
        &original_filename,
        &mime_type,
        bytes.len() as i64,
        user_id,
    )
    .await;

    let row = match insert_res {
        Ok(r) => r,
        Err(e) => {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(e.into());
        }
    };
    let content_path = course_file_content_path(course_code, row.id);

    Ok(CourseFileUploadResponse {
        id: row.id,
        content_path,
        mime_type: row.mime_type,
        byte_size: row.byte_size,
    })
}

pub async fn persist_course_image(
    pool: &PgPool,
    course_files_root: &Path,
    course_id: Uuid,
    course_code: &str,
    user_id: Uuid,
    bytes: Vec<u8>,
    original_filename: String,
    mime_type: String,
) -> Result<CourseFileUploadResponse, AppError> {
    let id = Uuid::new_v4();
    let ext = ext_for_mime(mime_type.as_str());
    let storage_key = format!("{id}.{ext}");
    let path = course_files::blob_disk_path(course_files_root, course_code, &storage_key);

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            AppError::invalid_input(format!("could not create storage directory: {e}"))
        })?;
    }

    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| AppError::invalid_input(format!("could not save file: {e}")))?;

    let insert_res = course_files::insert(
        pool,
        id,
        course_id,
        &storage_key,
        &original_filename,
        &mime_type,
        bytes.len() as i64,
        user_id,
    )
    .await;

    let row = match insert_res {
        Ok(r) => r,
        Err(e) => {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(e.into());
        }
    };
    let content_path = course_file_content_path(course_code, row.id);

    Ok(CourseFileUploadResponse {
        id: row.id,
        content_path,
        mime_type: row.mime_type,
        byte_size: row.byte_size,
    })
}
