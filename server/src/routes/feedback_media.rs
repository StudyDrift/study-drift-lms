use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::extract::DefaultBodyLimit;
use axum::extract::Multipart;
use axum::extract::Path;
use axum::extract::State;
use axum::http::header;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::routing::{delete, get, post, put};
use axum::Json;
use axum::Router;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::AppError;
use crate::http_auth::auth_user;
use crate::repos::course;
use crate::repos::course_structure;
use crate::repos::enrollment;
use crate::repos::feedback_media;
use crate::repos::module_assignment_submissions;
use crate::services::course_image_upload::encode_uri_path_segment;
use crate::services::feedback_media as fm;
use crate::services::feedback_media::MAX_FEEDBACK_MEDIA_BYTES;
use crate::services::feedback_media::MAX_RECORDING_SECS;
use crate::services::feedback_media_caption::spawn_caption_job;
use crate::state::AppState;

const INITIATE_PER_MINUTE: usize = 10;
static INITIATE_RL: OnceLock<Mutex<HashMap<Uuid, Vec<Instant>>>> = OnceLock::new();

fn initiate_rl_map() -> &'static Mutex<HashMap<Uuid, Vec<Instant>>> {
    INITIATE_RL.get_or_init(|| Mutex::new(HashMap::new()))
}

fn check_initiate_rate_limit(user_id: Uuid) -> Result<(), AppError> {
    let mut map = initiate_rl_map()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    let window = Duration::from_secs(60);
    let v = map.entry(user_id).or_default();
    v.retain(|t| now.duration_since(*t) < window);
    if v.len() >= INITIATE_PER_MINUTE {
        return Err(AppError::TooManyRequests(
            "Too many upload sessions; try again in a minute.".into(),
        ));
    }
    v.push(now);
    Ok(())
}

fn require_feedback_media(state: &AppState) -> Result<(), AppError> {
    if !state.feedback_media_enabled {
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

async fn load_submission(
    state: &AppState,
    course_code: &str,
    item_id: Uuid,
    submission_id: Uuid,
) -> Result<module_assignment_submissions::SubmissionRow, AppError> {
    let course_id = resolve_course_id(state, course_code).await?;
    let Some(s) = module_assignment_submissions::get_by_id_for_course(
        &state.pool,
        course_id,
        submission_id,
    )
    .await?
    else {
        return Err(AppError::NotFound);
    };
    if s.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    let Some(item) = course_structure::get_item_row(&state.pool, course_id, item_id).await? else {
        return Err(AppError::NotFound);
    };
    if item.kind != "assignment" {
        return Err(AppError::NotFound);
    }
    Ok(s)
}

fn can_view_media(user_id: Uuid, staff: bool, sub: &module_assignment_submissions::SubmissionRow) -> bool {
    staff || sub.submitted_by == user_id
}

fn can_upload_media(staff: bool) -> bool {
    staff
}

fn parse_u64_header(headers: &HeaderMap, name: &'static str) -> Result<u64, AppError> {
    let v = headers
        .get(name)
        .ok_or_else(|| AppError::invalid_input(format!("Missing `{name}` header.")))?;
    let s = v
        .to_str()
        .map_err(|_| AppError::invalid_input(format!("Invalid `{name}` header.")))?;
    s.parse::<u64>()
        .map_err(|_| AppError::invalid_input(format!("Invalid `{name}` header (expected integer).")))
}

/// Public path for a feedback media file (served with auth, same as course file content).
pub fn feedback_media_content_path(
    course_code: &str,
    item_id: Uuid,
    submission_id: Uuid,
    media_id: Uuid,
) -> String {
    format!(
        "/api/v1/courses/{}/assignments/{}/submissions/{}/feedback-media/{}/content",
        encode_uri_path_segment(course_code),
        item_id,
        submission_id,
        media_id
    )
}

fn feedback_caption_path(
    course_code: &str,
    item_id: Uuid,
    submission_id: Uuid,
    media_id: Uuid,
) -> String {
    format!(
        "/api/v1/courses/{}/assignments/{}/submissions/{}/feedback-media/{}/caption",
        encode_uri_path_segment(course_code),
        item_id,
        submission_id,
        media_id
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InitiateBody {
    #[serde(default)]
    mime_type: String,
    #[serde(default)]
    media_type: String,
    byte_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InitiateResponse {
    media_id: Uuid,
    chunk_size: u64,
    upload_path: String,
}

async fn post_initiate(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<InitiateBody>,
) -> Result<Json<InitiateResponse>, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    check_initiate_rate_limit(user.user_id)?;
    if body.byte_size == 0 || body.byte_size > MAX_FEEDBACK_MEDIA_BYTES {
        return Err(AppError::invalid_input(format!(
            "byteSize must be between 1 and {} (500 MB).",
            MAX_FEEDBACK_MEDIA_BYTES
        )));
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    if !can_upload_media(staff) {
        return Err(AppError::Forbidden);
    }
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let _ = load_submission(&state, &course_code, item_id, submission_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;

    let mime = body.mime_type.trim();
    if mime.is_empty() {
        return Err(AppError::invalid_input("mimeType is required."));
    }
    let Some(mime_norm) = fm::normalize_feedback_mime(Some(mime)) else {
        return Err(AppError::invalid_input("MIME type is not allowed for feedback media."));
    };
    let media = if !body.media_type.is_empty() {
        match body.media_type.as_str() {
            "audio" | "video" => body.media_type.as_str(),
            _ => {
                return Err(AppError::invalid_input(
                    "mediaType must be 'audio' or 'video' (or omitted).",
                ))
            }
        }
    } else {
        fm::media_type_for_mime(mime_norm).ok_or_else(|| {
            AppError::invalid_input("Could not infer mediaType from mimeType; pass mediaType.")
        })?
    };

    if media == "video" && !mime_norm.starts_with("video/") {
        return Err(AppError::invalid_input("mimeType does not match video mediaType."));
    }
    if media == "audio" && !mime_norm.starts_with("audio/") {
        return Err(AppError::invalid_input("mimeType does not match audio mediaType."));
    }

    let id = Uuid::new_v4();
    let storage_key = format!("{id}/upload");
    let dir = fm::feedback_dir(&state.course_files_root, &course_code);
    let path = dir.join(&storage_key);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::invalid_input(format!("could not create storage: {e}")))?;
    }

    feedback_media::insert_draft(
        &state.pool,
        id,
        submission_id,
        course_id,
        item_id,
        user.user_id,
        media,
        mime_norm,
        &storage_key,
        body.byte_size as i64,
    )
    .await
    .map_err(|e| AppError::invalid_input(e.to_string()))?;

    let upload_path = format!(
        "/api/v1/courses/{}/assignments/{}/submissions/{}/feedback-media/{}/blob",
        encode_uri_path_segment(&course_code),
        item_id,
        submission_id,
        id
    );

    Ok(Json(InitiateResponse {
        media_id: id,
        chunk_size: 8 * 1024 * 1024,
        upload_path,
    }))
}

async fn put_blob(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id, media_id)): Path<(String, Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    if !can_upload_media(staff) {
        return Err(AppError::Forbidden);
    }
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let _sub = load_submission(&state, &course_code, item_id, submission_id).await?;
    let offset = parse_u64_header(&headers, "x-upload-offset")?;
    if body.is_empty() {
        return Err(AppError::invalid_input("Request body is empty."));
    }
    if body.len() as u64 > 32 * 1024 * 1024 {
        return Err(AppError::invalid_input("Chunk is too large (max 32 MB per part)."));
    }

    let row = feedback_media::get_by_id(&state.pool, media_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.submission_id != submission_id
        || row.module_item_id != item_id
        || row.deleted_at.is_some()
        || !matches!(row.upload_complete, false)
    {
        return Err(AppError::NotFound);
    }
    if row.uploader_id != user.user_id {
        return Err(AppError::Forbidden);
    }

    if offset != row.bytes_received as u64 {
        return Err(AppError::invalid_input(
            "X-Upload-Offset must match bytes uploaded so far (resume from last offset).",
        ));
    }
    if offset + body.len() as u64 > row.expected_byte_size.unwrap_or(0) as u64 {
        return Err(AppError::invalid_input("Upload exceeds declared byte size."));
    }

    let path = fm::feedback_blob_path(&state.course_files_root, &course_code, &row.storage_key);
    if !path.exists() && offset > 0 {
        return Err(AppError::invalid_input("Upload offset invalid (no partial file)."));
    }
    if !path.exists() && offset == 0 {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| AppError::invalid_input(format!("storage: {e}")))?;
        }
    } else {
        let len = tokio::fs::metadata(&path)
            .await
            .map_err(|_| AppError::NotFound)?
            .len();
        if len != offset {
            return Err(AppError::invalid_input(format!(
                "Server file size does not match X-Upload-Offset (expected offset {len})."
            )));
        }
    }

    let mut f = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|e| AppError::invalid_input(format!("could not open upload file: {e}")))?;
    f.write_all(&body)
        .await
        .map_err(|e| AppError::invalid_input(format!("write failed: {e}")))?;

    let delta = body.len() as i64;
    feedback_media::add_bytes_received(&state.pool, media_id, delta)
        .await
        .map_err(|e| {
            if matches!(e, sqlx::Error::RowNotFound) {
                AppError::NotFound
            } else {
                e.into()
            }
        })?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteBody {
    duration_secs: Option<i32>,
}

async fn post_complete(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id, media_id)): Path<(String, Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<CompleteBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    if !can_upload_media(staff) {
        return Err(AppError::Forbidden);
    }
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let _sub = load_submission(&state, &course_code, item_id, submission_id).await?;

    let row = feedback_media::get_by_id(&state.pool, media_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.submission_id != submission_id || row.module_item_id != item_id {
        return Err(AppError::NotFound);
    }
    if row.uploader_id != user.user_id {
        return Err(AppError::Forbidden);
    }
    if row.upload_complete {
        return Err(AppError::invalid_input("This upload is already complete."));
    }
    if Some(row.bytes_received) != row.expected_byte_size {
        return Err(AppError::invalid_input(
            "All bytes have not been uploaded yet (bytesReceived != expected).",
        ));
    }
    let ext = fm::ext_for_mime(&row.mime_type);
    let new_key = format!("{media_id}/media.{ext}");
    let from = fm::feedback_blob_path(&state.course_files_root, &course_code, &row.storage_key);
    let to = fm::feedback_blob_path(&state.course_files_root, &course_code, &new_key);
    if let Some(parent) = to.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::invalid_input(e.to_string()))?;
    }
    tokio::fs::rename(&from, &to)
        .await
        .map_err(|e| AppError::invalid_input(format!("could not finalize file: {e}")))?;

    if let Some(ds) = body.duration_secs {
        if ds < 0 || ds > MAX_RECORDING_SECS {
            return Err(AppError::invalid_input(format!(
                "durationSecs must be between 0 and {MAX_RECORDING_SECS} (10 min)."
            )));
        }
    }

    let finalized = feedback_media::finalize_chunked_upload(
        &state.pool,
        media_id,
        &new_key,
        row.bytes_received,
        body.duration_secs,
    )
    .await
    .map_err(|e| {
        if matches!(e, sqlx::Error::RowNotFound) {
            AppError::invalid_input("Could not finalize (bytes must match the declared size).")
        } else {
            e.into()
        }
    })?;

    let cc = course_code.clone();
    spawn_caption_job(
        state.pool.clone(),
        state.open_router.clone(),
        state.course_files_root.clone(),
        cc,
        media_id,
    );

    tracing::info!(
        target: "lextures.audit",
        event = "feedback_media.uploaded",
        course_code = %course_code,
        submission_id = %submission_id,
        instructor_id = %user.user_id,
        media_id = %media_id,
        duration_secs = ?finalized.duration_secs,
        byte_size = finalized.byte_size,
        "finalized feedback media upload"
    );

    Ok(Json(serde_json::json!({ "ok": true, "media": feedback_media_to_json(
        &course_code,
        item_id,
        submission_id,
        &finalized
    )? })))
}

async fn post_upload_multipart(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    if !can_upload_media(staff) {
        return Err(AppError::Forbidden);
    }
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let sub = load_submission(&state, &course_code, item_id, submission_id).await?;
    let course_id = resolve_course_id(&state, &course_code).await?;

    let mut file_bytes: Option<Vec<u8>> = None;
    let mut content_type: Option<String> = None;
    let mut duration_from_form: Option<i32> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::invalid_input(format!("multipart: {e}")))?
    {
        let name = field.name().unwrap_or("");
        if name == "file" {
            let ct = field.content_type().map(|s| s.to_string());
            let bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::invalid_input(format!("read file: {e}")))?;
            if bytes.len() as u64 > MAX_FEEDBACK_MEDIA_BYTES {
                return Err(AppError::invalid_input("File is too large (max 500 MB)."));
            }
            file_bytes = Some(bytes.to_vec());
            content_type = ct;
        } else if name == "durationSecs" {
            let t = field
                .text()
                .await
                .map_err(|e| AppError::invalid_input(e.to_string()))?;
            duration_from_form = t.parse::<i32>().ok();
        }
    }
    let bytes = file_bytes.ok_or_else(|| AppError::invalid_input("Missing multipart field `file`."))?;
    let Some(m) = fm::normalize_feedback_mime(content_type.as_deref()) else {
        return Err(AppError::invalid_input("MIME type is not allowed for feedback media."));
    };
    let media = fm::media_type_for_mime(m)
        .ok_or_else(|| AppError::invalid_input("Could not infer media type from MIME."))?
        .to_string();

    let id = Uuid::new_v4();
    let ext = fm::ext_for_mime(m);
    let storage_key = format!("{id}/media.{ext}");
    let path = fm::feedback_blob_path(&state.course_files_root, &course_code, &storage_key);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::invalid_input(format!("{e}")))?;
    }
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| AppError::invalid_input(e.to_string()))?;

    if let Some(ds) = duration_from_form {
        if ds < 0 || ds > MAX_RECORDING_SECS {
            return Err(AppError::invalid_input(format!(
                "durationSecs must be between 0 and {MAX_RECORDING_SECS} (10 min)."
            )));
        }
    }

    let _ = sub;
    let row = feedback_media::insert_finalized(
        &state.pool,
        id,
        submission_id,
        course_id,
        item_id,
        user.user_id,
        &media,
        m,
        &storage_key,
        bytes.len() as i64,
        duration_from_form,
    )
    .await
    .map_err(|e: sqlx::Error| AppError::invalid_input(e.to_string()))?;

    let cc = course_code.clone();
    spawn_caption_job(
        state.pool.clone(),
        state.open_router.clone(),
        state.course_files_root.clone(),
        cc,
        id,
    );

    Ok(Json(serde_json::json!({ "ok": true, "media": feedback_media_to_json(
        &course_code,
        item_id,
        submission_id,
        &row
    )? })))
}

fn feedback_media_to_json(
    course_code: &str,
    item_id: Uuid,
    submission_id: Uuid,
    row: &feedback_media::FeedbackMediaRow,
) -> Result<serde_json::Value, AppError> {
    if !row.upload_complete {
        return Err(AppError::invalid_input("Media row not finalized."));
    }
    Ok(serde_json::json!({
        "id": row.id,
        "mediaType": row.media_type,
        "mimeType": row.mime_type,
        "durationSecs": row.duration_secs,
        "captionStatus": row.caption_status,
        "contentPath": feedback_media_content_path(course_code, item_id, submission_id, row.id),
        "createdAt": row.created_at,
    }))
}

async fn get_list(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id)): Path<(String, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    let sub = load_submission(&state, &course_code, item_id, submission_id).await?;
    if !can_view_media(user.user_id, staff, &sub) {
        return Err(AppError::Forbidden);
    }
    let rows = feedback_media::list_for_submission(&state.pool, submission_id).await?;
    let mut out = Vec::new();
    for r in &rows {
        if r.upload_complete {
            out.push(feedback_media_to_json(&course_code, item_id, submission_id, r)?);
        }
    }
    Ok(Json(serde_json::json!({ "items": out })))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UrlResponse {
    content_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    caption_path: Option<String>,
    /// RFC3339; URL remains authorized via session/JWT (plan: short-lived pre-signed in future S3).
    expires_at: chrono::DateTime<chrono::Utc>,
}

async fn get_playback_url(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id, media_id)): Path<(String, Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<UrlResponse>, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    let sub = load_submission(&state, &course_code, item_id, submission_id).await?;
    if !can_view_media(user.user_id, staff, &sub) {
        return Err(AppError::Forbidden);
    }
    let row = feedback_media::get_by_id(&state.pool, media_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.submission_id != submission_id || row.deleted_at.is_some() || !row.upload_complete {
        return Err(AppError::NotFound);
    }
    let cap = (row.caption_status == "done")
        .then(|| feedback_caption_path(&course_code, item_id, submission_id, media_id));
    Ok(Json(UrlResponse {
        content_path: feedback_media_content_path(&course_code, item_id, submission_id, media_id),
        caption_path: cap,
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    }))
}

async fn get_content(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id, media_id)): Path<(String, Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    let sub = load_submission(&state, &course_code, item_id, submission_id).await?;
    if !can_view_media(user.user_id, staff, &sub) {
        return Err(AppError::Forbidden);
    }
    let row = feedback_media::get_by_id(&state.pool, media_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.submission_id != submission_id || row.deleted_at.is_some() || !row.upload_complete {
        return Err(AppError::NotFound);
    }
    let path = fm::feedback_blob_path(&state.course_files_root, &course_code, &row.storage_key);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| AppError::NotFound)?;
    axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, row.mime_type.as_str())
        .header(header::CACHE_CONTROL, "private, max-age=60")
        .body(Body::from(bytes))
        .map_err(|e| AppError::invalid_input(e.to_string()))
}

async fn get_caption(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id, media_id)): Path<(String, Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<axum::response::Response, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    let sub = load_submission(&state, &course_code, item_id, submission_id).await?;
    if !can_view_media(user.user_id, staff, &sub) {
        return Err(AppError::Forbidden);
    }
    let row = feedback_media::get_by_id(&state.pool, media_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.submission_id != submission_id || row.deleted_at.is_some() || !row.upload_complete {
        return Err(AppError::NotFound);
    }
    let key = row.caption_key.as_ref().ok_or(AppError::NotFound)?;
    let path = fm::feedback_blob_path(&state.course_files_root, &course_code, key);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| AppError::NotFound)?;
    axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/vtt; charset=utf-8")
        .header(header::CACHE_CONTROL, "private, max-age=60")
        .body(Body::from(bytes))
        .map_err(|e| AppError::invalid_input(e.to_string()))
}

async fn delete_media(
    State(state): State<AppState>,
    Path((course_code, item_id, submission_id, media_id)): Path<(String, Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    require_feedback_media(&state)?;
    let user = auth_user(&state, &headers)?;
    let ok = enrollment::user_has_access(&state.pool, &course_code, user.user_id).await?;
    if !ok {
        return Err(AppError::Forbidden);
    }
    let staff = enrollment::user_is_course_staff(&state.pool, &course_code, user.user_id).await?;
    let _sub = load_submission(&state, &course_code, item_id, submission_id).await?;
    let row = feedback_media::get_by_id(&state.pool, media_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if row.submission_id != submission_id {
        return Err(AppError::NotFound);
    }
    if row.uploader_id != user.user_id && !staff {
        return Err(AppError::Forbidden);
    }
    if !feedback_media::soft_delete(&state.pool, media_id).await? {
        return Err(AppError::NotFound);
    }
    let p1 = fm::feedback_blob_path(&state.course_files_root, &course_code, &row.storage_key);
    let _ = tokio::fs::remove_file(&p1).await;
    if let Some(ck) = &row.caption_key {
        let p2 = fm::feedback_blob_path(&state.course_files_root, &course_code, ck);
        let _ = tokio::fs::remove_file(&p2).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media/initiate",
            post(post_initiate),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media/upload",
            post(post_upload_multipart).layer(DefaultBodyLimit::max(500 * 1024 * 1024)),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media",
            get(get_list),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media/{media_id}/url",
            get(get_playback_url),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media/{media_id}/content",
            get(get_content),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media/{media_id}/caption",
            get(get_caption),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media/{media_id}",
            delete(delete_media),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media/{media_id}/blob",
            put(put_blob).layer(DefaultBodyLimit::max(33 * 1024 * 1024)),
        )
        .route(
            "/api/v1/courses/{course_code}/assignments/{item_id}/submissions/{submission_id}/feedback-media/{media_id}/complete",
            post(post_complete),
        )
}
