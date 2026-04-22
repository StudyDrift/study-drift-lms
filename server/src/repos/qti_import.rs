//! QTI / Common Cartridge import job persistence (plan 2.13).

use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use sqlx::{Executor, PgPool, Postgres};
use uuid::Uuid;

use crate::db::schema;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ImportJobRow {
    pub id: Uuid,
    pub course_id: Uuid,
    pub import_type: String,
    pub original_filename: String,
    pub status: String,
    pub total_items: Option<i32>,
    pub processed_items: i32,
    pub succeeded_items: i32,
    pub failed_items: i32,
    pub skipped_items: i32,
    pub error_log: JsonValue,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_by: Uuid,
    pub created_at: DateTime<Utc>,
}

pub async fn course_import_flags(
    pool: &PgPool,
    course_id: Uuid,
) -> Result<Option<(bool, bool)>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT question_bank_enabled, qti_import_enabled
        FROM {}
        WHERE id = $1
        "#,
        schema::COURSES
    ))
    .bind(course_id)
    .fetch_optional(pool)
    .await
}

pub async fn insert_import_job(
    pool: &PgPool,
    course_id: Uuid,
    import_type: &str,
    original_filename: &str,
    created_by: Uuid,
) -> Result<Uuid, sqlx::Error> {
    let id: Uuid = sqlx::query_scalar(&format!(
        r#"
        INSERT INTO {} (course_id, import_type, original_filename, status, created_by)
        VALUES ($1, $2, $3, 'pending', $4)
        RETURNING id
        "#,
        schema::IMPORT_JOBS
    ))
    .bind(course_id)
    .bind(import_type)
    .bind(original_filename)
    .bind(created_by)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn mark_job_running(
    pool: &PgPool,
    job_id: Uuid,
    total_items: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'running',
            total_items = $2,
            started_at = COALESCE(started_at, NOW()),
            processed_items = 0,
            succeeded_items = 0,
            failed_items = 0,
            skipped_items = 0,
            error_log = '[]'::jsonb
        WHERE id = $1
        "#,
        schema::IMPORT_JOBS
    ))
    .bind(job_id)
    .bind(total_items)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn bump_job_counters(
    pool: &PgPool,
    job_id: Uuid,
    processed_delta: i32,
    succeeded_delta: i32,
    failed_delta: i32,
    skipped_delta: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET processed_items = processed_items + $2,
            succeeded_items = succeeded_items + $3,
            failed_items = failed_items + $4,
            skipped_items = skipped_items + $5
        WHERE id = $1
        "#,
        schema::IMPORT_JOBS
    ))
    .bind(job_id)
    .bind(processed_delta)
    .bind(succeeded_delta)
    .bind(failed_delta)
    .bind(skipped_delta)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn append_job_error(
    pool: &PgPool,
    job_id: Uuid,
    entry: &JsonValue,
) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET error_log = error_log || jsonb_build_array($2::jsonb)
        WHERE id = $1
        "#,
        schema::IMPORT_JOBS
    ))
    .bind(job_id)
    .bind(entry)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_job_done(pool: &PgPool, job_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'done',
            completed_at = NOW()
        WHERE id = $1
        "#,
        schema::IMPORT_JOBS
    ))
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_job_failed(
    pool: &PgPool,
    job_id: Uuid,
    message: &str,
) -> Result<(), sqlx::Error> {
    let entry = serde_json::json!({
        "item_id": null,
        "reason": message,
    });
    sqlx::query(&format!(
        r#"
        UPDATE {}
        SET status = 'failed',
            completed_at = NOW(),
            error_log = error_log || jsonb_build_array($2::jsonb)
        WHERE id = $1
        "#,
        schema::IMPORT_JOBS
    ))
    .bind(job_id)
    .bind(entry)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_import_job(
    pool: &PgPool,
    job_id: Uuid,
) -> Result<Option<ImportJobRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT id, course_id, import_type, original_filename, status,
               total_items, processed_items, succeeded_items, failed_items, skipped_items,
               error_log, started_at, completed_at, created_by, created_at
        FROM {}
        WHERE id = $1
        "#,
        schema::IMPORT_JOBS
    ))
    .bind(job_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_import_jobs_for_user(
    pool: &PgPool,
    user_id: Uuid,
    course_id: Option<Uuid>,
    limit: i64,
) -> Result<Vec<ImportJobRow>, sqlx::Error> {
    sqlx::query_as(&format!(
        r#"
        SELECT id, course_id, import_type, original_filename, status,
               total_items, processed_items, succeeded_items, failed_items, skipped_items,
               error_log, started_at, completed_at, created_by, created_at
        FROM {}
        WHERE created_by = $1
          AND ($2::uuid IS NULL OR course_id = $2)
        ORDER BY created_at DESC
        LIMIT $3
        "#,
        schema::IMPORT_JOBS
    ))
    .bind(user_id)
    .bind(course_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn find_imported_question_id(
    pool: &PgPool,
    course_id: Uuid,
    source_type: &str,
    source_identifier: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(&format!(
        r#"
        SELECT question_id FROM {}
        WHERE course_id = $1 AND source_type = $2 AND source_identifier = $3
        "#,
        schema::IMPORTED_QUESTION_SOURCES
    ))
    .bind(course_id)
    .bind(source_type)
    .bind(source_identifier)
    .fetch_optional(pool)
    .await
}

pub async fn insert_imported_source<'e, E>(
    ex: E,
    course_id: Uuid,
    question_id: Uuid,
    source_type: &str,
    source_identifier: &str,
    import_job_id: Uuid,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(&format!(
        r#"
        INSERT INTO {} (course_id, question_id, source_type, source_identifier, import_job_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (course_id, source_type, source_identifier) DO NOTHING
        "#,
        schema::IMPORTED_QUESTION_SOURCES
    ))
    .bind(course_id)
    .bind(question_id)
    .bind(source_type)
    .bind(source_identifier)
    .bind(import_job_id)
    .execute(ex)
    .await?;
    Ok(())
}
