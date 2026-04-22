use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FeedbackMediaRow {
    pub id: Uuid,
    pub submission_id: Uuid,
    pub course_id: Uuid,
    pub module_item_id: Uuid,
    pub uploader_id: Uuid,
    pub media_type: String,
    pub mime_type: String,
    pub storage_key: String,
    pub byte_size: i64,
    pub duration_secs: Option<i32>,
    pub caption_status: String,
    pub caption_key: Option<String>,
    pub upload_complete: bool,
    pub expected_byte_size: Option<i64>,
    pub bytes_received: i64,
    pub created_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

pub async fn insert_draft(
    pool: &PgPool,
    id: Uuid,
    submission_id: Uuid,
    course_id: Uuid,
    module_item_id: Uuid,
    uploader_id: Uuid,
    media_type: &str,
    mime_type: &str,
    storage_key: &str,
    expected_byte_size: i64,
) -> Result<FeedbackMediaRow, sqlx::Error> {
    sqlx::query_as::<_, FeedbackMediaRow>(&format!(
        r#"
        INSERT INTO {} (
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, expected_byte_size,
            bytes_received, upload_complete
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, false)
        RETURNING
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, byte_size, duration_secs,
            caption_status, caption_key, upload_complete, expected_byte_size, bytes_received,
            created_at, deleted_at
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .bind(submission_id)
    .bind(course_id)
    .bind(module_item_id)
    .bind(uploader_id)
    .bind(media_type)
    .bind(mime_type)
    .bind(storage_key)
    .bind(expected_byte_size)
    .fetch_one(pool)
    .await
}

/// Single-shot create when the entire body is available (upload_complete = true).
pub async fn insert_finalized(
    pool: &PgPool,
    id: Uuid,
    submission_id: Uuid,
    course_id: Uuid,
    module_item_id: Uuid,
    uploader_id: Uuid,
    media_type: &str,
    mime_type: &str,
    storage_key: &str,
    byte_size: i64,
    duration_secs: Option<i32>,
) -> Result<FeedbackMediaRow, sqlx::Error> {
    sqlx::query_as::<_, FeedbackMediaRow>(&format!(
        r#"
        INSERT INTO {} (
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, byte_size, duration_secs,
            expected_byte_size, bytes_received, upload_complete
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $9, true)
        RETURNING
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, byte_size, duration_secs,
            caption_status, caption_key, upload_complete, expected_byte_size, bytes_received,
            created_at, deleted_at
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .bind(submission_id)
    .bind(course_id)
    .bind(module_item_id)
    .bind(uploader_id)
    .bind(media_type)
    .bind(mime_type)
    .bind(storage_key)
    .bind(byte_size)
    .bind(duration_secs)
    .fetch_one(pool)
    .await
}

pub async fn add_bytes_received(
    pool: &PgPool,
    id: Uuid,
    delta: i64,
) -> Result<FeedbackMediaRow, sqlx::Error> {
    sqlx::query_as::<_, FeedbackMediaRow>(&format!(
        r#"
        UPDATE {}
        SET bytes_received = bytes_received + $2
        WHERE id = $1 AND upload_complete = false AND deleted_at IS NULL
        RETURNING
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, byte_size, duration_secs,
            caption_status, caption_key, upload_complete, expected_byte_size, bytes_received,
            created_at, deleted_at
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .bind(delta)
    .fetch_one(pool)
    .await
}

pub async fn set_upload_finalized(
    pool: &PgPool,
    id: Uuid,
    byte_size: i64,
    duration_secs: Option<i32>,
) -> Result<FeedbackMediaRow, sqlx::Error> {
    sqlx::query_as::<_, FeedbackMediaRow>(&format!(
        r#"
        UPDATE {}
        SET upload_complete = true,
            byte_size = $2,
            bytes_received = $2,
            duration_secs = COALESCE($3, duration_secs)
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, byte_size, duration_secs,
            caption_status, caption_key, upload_complete, expected_byte_size, bytes_received,
            created_at, deleted_at
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .bind(byte_size)
    .bind(duration_secs)
    .fetch_one(pool)
    .await
}

pub async fn finalize_chunked_upload(
    pool: &PgPool,
    id: Uuid,
    new_storage_key: &str,
    byte_size: i64,
    duration_secs: Option<i32>,
) -> Result<FeedbackMediaRow, sqlx::Error> {
    sqlx::query_as::<_, FeedbackMediaRow>(&format!(
        r#"
        UPDATE {}
        SET upload_complete = true,
            storage_key = $2,
            byte_size = $3,
            bytes_received = $3,
            duration_secs = COALESCE($4, duration_secs)
        WHERE id = $1
          AND upload_complete = false
          AND deleted_at IS NULL
          AND bytes_received = expected_byte_size
        RETURNING
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, byte_size, duration_secs,
            caption_status, caption_key, upload_complete, expected_byte_size, bytes_received,
            created_at, deleted_at
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .bind(new_storage_key)
    .bind(byte_size)
    .bind(duration_secs)
    .fetch_one(pool)
    .await
}

pub async fn get_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<FeedbackMediaRow>, sqlx::Error> {
    sqlx::query_as::<_, FeedbackMediaRow>(&format!(
        r#"
        SELECT
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, byte_size, duration_secs,
            caption_status, caption_key, upload_complete, expected_byte_size, bytes_received,
            created_at, deleted_at
        FROM {}
        WHERE id = $1
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn list_for_submission(
    pool: &PgPool,
    submission_id: Uuid,
) -> Result<Vec<FeedbackMediaRow>, sqlx::Error> {
    sqlx::query_as::<_, FeedbackMediaRow>(&format!(
        r#"
        SELECT
            id, submission_id, course_id, module_item_id, uploader_id,
            media_type, mime_type, storage_key, byte_size, duration_secs,
            caption_status, caption_key, upload_complete, expected_byte_size, bytes_received,
            created_at, deleted_at
        FROM {}
        WHERE submission_id = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(submission_id)
    .fetch_all(pool)
    .await
}

pub async fn soft_delete(
    pool: &PgPool,
    id: Uuid,
) -> Result<bool, sqlx::Error> {
    let n = sqlx::query(&format!(
        r#"
        UPDATE {}
        SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(n > 0)
}

pub async fn set_caption_status(
    pool: &PgPool,
    id: Uuid,
    status: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"UPDATE {} SET caption_status = $2 WHERE id = $1"#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .bind(status)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_caption_done(
    pool: &PgPool,
    id: Uuid,
    caption_key: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET caption_status = 'done', caption_key = $2
        WHERE id = $1
        "#,
        schema::SUBMISSION_FEEDBACK_MEDIA
    ))
    .bind(id)
    .bind(caption_key)
    .execute(pool)
    .await?;
    Ok(())
}
